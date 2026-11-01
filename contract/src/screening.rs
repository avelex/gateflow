use crate::*;
use near_sdk::serde_json::{json, Value};
use near_sdk::{Gas, Promise};

pub const OUTLAYER_GAS: Gas = Gas::from_tgas(100);
pub const SCREENED_CALLBACK_GAS: Gas = Gas::from_tgas(40);
/// Longest 1Click deposit address stored; real ones (EVM, BTC, ZEC) are under 100 bytes.
pub const MAX_DEPOSIT_ADDRESS_BYTES: usize = 128;

#[near]
impl Gateflow {
    /// Permissionless, once per `ref` payment: draws one execution deposit from gateway fuel,
    /// stores the 1Click deposit address and asks the enclave to screen the origin senders.
    pub fn screen_intents(&mut self, payment: PaymentId, deposit_address: String) -> Promise {
        let p = self.payment(payment);
        require!(p.status == PaymentStatus::Pending, "payment is not pending");
        let reference = p.reference.clone().unwrap_or_else(|| env::panic_str("payment has no ref"));
        require!(p.deposit_address.is_none(), "screening already started");
        require!(
            (1..=MAX_DEPOSIT_ADDRESS_BYTES).contains(&deposit_address.len()),
            "invalid deposit address"
        );
        self.draw_fuel(p.gateway);
        self.payments.get_mut(payment as u32).unwrap().deposit_address = Some(deposit_address.clone());
        self.request_screening(
            payment,
            json!({
                "kind": "screen_intents",
                "deposit_address": deposit_address,
                "invoice": p.invoice,
                "ref": reference,
                "amount": p.amount,
                "max_risk": p.max_risk,
            }),
        )
    }
}

impl Gateflow {
    /// Takes one execution deposit from the gateway's fuel, or panics.
    pub(crate) fn draw_fuel(&mut self, gateway: GatewayId) {
        let deposit = self.execution_deposit;
        let g = self.gateway_mut(gateway);
        require!(g.fuel >= deposit, "gateway has no fuel for screening");
        g.fuel = g.fuel.saturating_sub(deposit);
    }

    /// One OutLayer execution of the configured project with `request` as stdin, then `on_screened(payment)`.
    /// Shape per design decision 10.
    pub(crate) fn request_screening(&self, payment: PaymentId, request: Value) -> Promise {
        let args = json!({
            "source": {"Project": {"project_id": self.enclave.project, "version_key": null}},
            "resource_limits": {},
            "input_data": request.to_string(),
            "secrets_ref": {"profile": "default", "account_id": self.enclave.secrets_owner},
            "response_format": "Json",
            "payer_account_id": env::current_account_id(),
        });
        Promise::new(self.enclave.outlayer.clone())
            .function_call("request_execution", args.to_string().into_bytes(), self.execution_deposit, OUTLAYER_GAS)
            .then(Promise::new(env::current_account_id()).function_call(
                "on_screened",
                json!({"payment": payment}).to_string().into_bytes(),
                NearToken::from_yoctonear(0),
                SCREENED_CALLBACK_GAS,
            ))
    }
}

#[cfg(test)]
mod tests {
    use crate::testing::*;
    use crate::PaymentStatus;
    use near_sdk::serde_json::{self, json};
    use near_sdk::NearToken;

    fn relay() -> near_sdk::AccountId {
        "relay.near".parse().unwrap()
    }

    fn with_ref_payment() -> crate::Gateflow {
        let mut c = with_invoice();
        pay(&mut c, &usdc(), &intents(), TEN_USDC, r#"{"invoice":0,"ref":"r1","refund_to":"bob.near"}"#, T0);
        call(&relay(), NearToken::from_yoctonear(0), T0 + 60);
        c
    }

    #[test]
    fn screen_intents_draws_fuel_and_stores_address() {
        let mut c = with_ref_payment();
        let _ = c.screen_intents(0, "dep1".into());
        assert_eq!(c.get_payment(0).unwrap().deposit_address.as_deref(), Some("dep1"));
        assert_eq!(c.get_gateway(0).unwrap().fuel, NearToken::from_millinear(40));
        let (to, method, args, deposit) = calls()[0].clone();
        assert_eq!((to.as_str(), method.as_str(), deposit), ("outlayer.near", "request_execution", NearToken::from_millinear(10)));
        let input: serde_json::Value = serde_json::from_str(args["input_data"].as_str().unwrap()).unwrap();
        assert_eq!(
            input,
            json!({"kind": "screen_intents", "deposit_address": "dep1", "invoice": 0, "ref": "r1", "amount": "10000000", "max_risk": 50})
        );
        assert!(calls().iter().any(|(_, m, a, _)| m == "on_screened" && a == &json!({"payment": 0})));
    }

    #[test]
    fn screen_intents_twice_fails() {
        let mut c = with_ref_payment();
        let _ = c.screen_intents(0, "dep1".into());
        call(&relay(), NearToken::from_yoctonear(0), T0 + 61);
        let res = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| { let _ = c.screen_intents(0, "dep2".into()); }));
        let err = *res.unwrap_err().downcast::<String>().unwrap();
        assert!(err.contains("screening already started"), "{err}");
        assert_eq!(c.get_gateway(0).unwrap().fuel, NearToken::from_millinear(40));
        assert_eq!(c.get_payment(0).unwrap().deposit_address.as_deref(), Some("dep1"));
    }

    #[test]
    #[should_panic(expected = "payment has no ref")]
    fn screen_intents_without_ref_fails() {
        let mut c = with_payment();
        let _ = c.screen_intents(0, "dep1".into());
    }

    #[test]
    fn screen_intents_without_fuel_fails() {
        let mut c = setup();
        call(&merchant(), NearToken::from_millinear(9), T0);
        c.create_gateway(merchant(), policy(50));
        as_caller(&op());
        c.add_token(usdc());
        as_caller(&merchant());
        c.create_invoice(0, usdc(), near_sdk::json_types::U128(TEN_USDC), 3600, None);
        pay(&mut c, &usdc(), &intents(), TEN_USDC, r#"{"invoice":0,"ref":"r1"}"#, T0);
        call(&relay(), NearToken::from_yoctonear(0), T0 + 60);
        let res = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| { let _ = c.screen_intents(0, "dep1".into()); }));
        let err = *res.unwrap_err().downcast::<String>().unwrap();
        assert!(err.contains("gateway has no fuel for screening"), "{err}");
        let p = c.get_payment(0).unwrap();
        assert_eq!((p.status, p.deposit_address), (PaymentStatus::Pending, None));
    }

    #[test]
    #[should_panic(expected = "payment is not pending")]
    fn screen_intents_on_refunded_fails() {
        let mut c = with_invoice();
        pay(&mut c, &usdc(), &intents(), TEN_USDC - 1, r#"{"invoice":0,"ref":"r1"}"#, T0);
        call(&relay(), NearToken::from_yoctonear(0), T0 + 60);
        let _ = c.screen_intents(0, "dep1".into());
    }

    #[test]
    fn reclaim_after_screening_started() {
        let mut c = with_ref_payment();
        let _ = c.screen_intents(0, "dep1".into());
        call(&relay(), NearToken::from_yoctonear(0), T0 + 901);
        let _ = c.reclaim(0);
        assert_eq!(c.get_payment(0).unwrap().status, PaymentStatus::Refunded);
        assert_eq!(ft_transfer().1, "bob.near");
    }

    #[test]
    #[should_panic(expected = "invalid deposit address")]
    fn screen_intents_rejects_oversized_address() {
        let mut c = with_ref_payment();
        let _ = c.screen_intents(0, "x".repeat(129));
    }

    #[test]
    #[should_panic(expected = "invalid deposit address")]
    fn screen_intents_rejects_empty_address() {
        let mut c = with_ref_payment();
        let _ = c.screen_intents(0, String::new());
    }
}
