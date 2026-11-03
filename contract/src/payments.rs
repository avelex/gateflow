use crate::invoices::{now_sec, page};
use crate::*;
use near_sdk::json_types::U128;
use near_sdk::serde_json::{self, json};
use near_sdk::PromiseOrValue;

/// Longest `ref` stored; the relay sends 32 hex characters.
pub const MAX_REF_BYTES: usize = 64;

#[near]
impl Gateflow {
    /// NEP-141 receiver. Every payment names an invoice in `msg`; see design decision 3 for the order of checks.
    pub fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> PromiseOrValue<U128> {
        let token = env::predecessor_account_id();
        require!(self.tokens.contains(&token), "token not accepted");
        let msg: PayMsg = serde_json::from_str(&msg).unwrap_or_else(|_| env::panic_str("invalid msg"));
        let invoice = self.get_invoice(msg.invoice).unwrap_or_else(|| env::panic_str("unknown invoice"));
        let refund_to = msg.refund_to.unwrap_or_else(|| sender_id.clone());

        if let Some(reference) = msg.reference {
            // 1Click delivery: never panic from here on, or 1Click loses the funds.
            require!(sender_id == self.intents, "ref payments only from intents.near");
            // An oversized ref is refunded and not stored, so it cannot grow storage.
            let valid = (1..=MAX_REF_BYTES).contains(&reference.len());
            let duplicate = valid && self.refs.contains_key(&reference);
            let accepted = valid && !duplicate && check_invoice(&invoice, &token, amount).is_ok();
            let stored = valid.then(|| reference.clone());
            let id = self.open_payment(msg.invoice, &invoice, sender_id, refund_to, token, amount, stored, accepted);
            if valid && !duplicate {
                self.refs.insert(reference, id);
            }
            if !accepted {
                self.close(id, false).detach();
            }
            return PromiseOrValue::Value(U128(0));
        }

        if let Err(e) = check_invoice(&invoice, &token, amount) {
            env::panic_str(e);
        }
        self.draw_fuel(invoice.gateway);
        let max_risk = self.gateways.get(invoice.gateway).unwrap().policy.max_risk;
        let id = self.open_payment(msg.invoice, &invoice, sender_id.clone(), refund_to, token, amount, None, true);
        self.request_screening(id, json!({"kind": "screen", "payer": sender_id, "max_risk": max_risk})).detach();
        PromiseOrValue::Value(U128(0))
    }

    pub fn get_payment(&self, payment: PaymentId) -> Option<Payment> {
        u32::try_from(payment).ok().and_then(|i| self.payments.get(i)).cloned()
    }

    pub fn get_payment_by_ref(&self, reference: String) -> Option<(PaymentId, Payment)> {
        self.refs.get(&reference).map(|&id| (id, self.get_payment(id).unwrap()))
    }

    pub fn get_payments(&self, gateway: GatewayId, from_index: u32, limit: u32) -> Vec<(PaymentId, Payment)> {
        let count = self.gateways.get(gateway).map_or(0, |g| g.payments);
        page(&self.payment_index, gateway, count, from_index, limit)
            .into_iter()
            .map(|id| (id, self.get_payment(id).unwrap()))
            .collect()
    }
}

impl Gateflow {
    /// Records a Pending payment, indexes it under its gateway and emits `payment_opened`.
    /// With `link_invoice` the invoice moves to Paying; a payment refunded at delivery leaves it untouched.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn open_payment(
        &mut self,
        invoice_id: InvoiceId,
        invoice: &Invoice,
        payer: AccountId,
        refund_to: AccountId,
        token: AccountId,
        amount: U128,
        reference: Option<String>,
        link_invoice: bool,
    ) -> PaymentId {
        let id = PaymentId::from(self.payments.len());
        let g = self.gateway_mut(invoice.gateway);
        let slot = g.payments;
        g.payments += 1;
        let max_risk = g.policy.max_risk;
        self.payment_index.insert((invoice.gateway, slot), id);
        let mut data = json!({"payment": id, "invoice": invoice_id, "gateway": invoice.gateway});
        if let Some(r) = &reference {
            data["ref"] = json!(r);
        }
        self.payments.push(Payment {
            gateway: invoice.gateway,
            invoice: invoice_id,
            payer,
            refund_to,
            token,
            amount,
            reference,
            deposit_address: None,
            opened_at_sec: now_sec(),
            max_risk,
            status: PaymentStatus::Pending,
        });
        if link_invoice {
            let inv = self.invoices.get_mut(invoice_id as u32).unwrap();
            inv.status = InvoiceStatus::Paying;
            inv.payment = Some(id);
        }
        events::emit("payment_opened", data);
        id
    }
}

/// The invoice checks a payment must pass, in order; `Err` carries the exact panic message.
pub(crate) fn check_invoice(invoice: &Invoice, token: &AccountId, amount: U128) -> Result<(), &'static str> {
    if invoice.status != InvoiceStatus::Open {
        return Err("invoice is not open");
    }
    if now_sec() >= invoice.expires_at_sec {
        return Err("invoice expired");
    }
    if &invoice.token != token {
        return Err("wrong token for this invoice");
    }
    if invoice.amount != amount {
        return Err("amount does not match the invoice");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use crate::testing::*;
    use crate::{InvoiceStatus, PaymentStatus};
    use near_sdk::serde_json::json;
    use near_sdk::test_utils::get_logs;
    use near_sdk::NearToken;

    const MSG: &str = r#"{"invoice":0}"#;

    #[test]
    #[should_panic(expected = "token not accepted")]
    fn wrong_token_rejected() {
        let mut c = with_invoice();
        pay(&mut c, &"nbtc.bridge.near".parse().unwrap(), &payer(), TEN_USDC, MSG, T0);
    }

    #[test]
    #[should_panic]
    fn malformed_msg_rejected() {
        let mut c = with_invoice();
        pay(&mut c, &usdc(), &payer(), TEN_USDC, "x", T0);
    }

    #[test]
    fn payment_without_invoice() {
        let mut c = with_invoice();
        let res = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            pay(&mut c, &usdc(), &payer(), TEN_USDC, r#"{"refund_to":"bob.near"}"#, T0)
        }));
        assert!(res.is_err());
        assert!(c.get_payments(0, 0, 10).is_empty());
    }

    #[test]
    #[should_panic(expected = "unknown invoice")]
    fn unknown_invoice() {
        let mut c = with_invoice();
        pay(&mut c, &usdc(), &payer(), TEN_USDC, r#"{"invoice":9}"#, T0);
    }

    #[test]
    #[should_panic(expected = "amount does not match the invoice")]
    fn amount_mismatch() {
        let mut c = with_invoice();
        pay(&mut c, &usdc(), &payer(), TEN_USDC - 1_000_000, MSG, T0);
    }

    #[test]
    #[should_panic(expected = "wrong token for this invoice")]
    fn token_mismatch() {
        let mut c = with_invoice();
        as_caller(&op());
        c.add_token("nbtc.bridge.near".parse().unwrap());
        pay(&mut c, &"nbtc.bridge.near".parse().unwrap(), &payer(), TEN_USDC, MSG, T0);
    }

    #[test]
    #[should_panic(expected = "invoice expired")]
    fn invoice_expired_at_boundary() {
        let mut c = with_invoice();
        pay(&mut c, &usdc(), &payer(), TEN_USDC, MSG, T0 + 3600);
    }

    #[test]
    #[should_panic(expected = "invoice is not open")]
    fn second_payment_while_paying() {
        let mut c = with_invoice();
        pay(&mut c, &usdc(), &payer(), TEN_USDC, MSG, T0);
        pay(&mut c, &usdc(), &payer(), TEN_USDC, MSG, T0);
    }

    #[test]
    #[should_panic(expected = "gateway has no fuel for screening")]
    fn no_fuel_rejected() {
        let mut c = setup();
        call(&merchant(), NearToken::from_millinear(10), T0); // invoice storage then takes fuel below one deposit
        c.create_gateway(merchant(), policy(50));
        as_caller(&op());
        c.add_token(usdc());
        as_caller(&merchant());
        c.create_invoice(0, usdc(), near_sdk::json_types::U128(TEN_USDC), 3600, None);
        pay(&mut c, &usdc(), &payer(), TEN_USDC, MSG, T0);
    }

    #[test]
    #[should_panic(expected = "token not accepted")]
    fn removed_token_rejects_new_payment() {
        let mut c = with_invoice();
        as_caller(&op());
        c.remove_token(usdc());
        pay(&mut c, &usdc(), &payer(), TEN_USDC, MSG, T0);
    }

    #[test]
    fn direct_payment_opens() {
        let mut c = with_invoice();
        assert_eq!(pay(&mut c, &usdc(), &payer(), TEN_USDC, MSG, T0 + 10), 0);

        let p = c.get_payment(0).unwrap();
        assert_eq!(p.status, PaymentStatus::Pending);
        assert_eq!((p.gateway, p.invoice, p.max_risk), (0, 0, 50));
        assert_eq!((p.payer.clone(), p.refund_to.clone(), p.token.clone()), (payer(), payer(), usdc()));
        assert_eq!((p.amount.0, p.opened_at_sec, p.reference.clone()), (TEN_USDC, T0 + 10, None));

        let i = c.get_invoice(0).unwrap();
        assert_eq!((i.status, i.payment), (InvoiceStatus::Paying, Some(0)));
        let g = c.get_gateway(0).unwrap();
        assert_eq!((g.fuel, g.payments), (NearToken::from_millinear(40), 1));

        assert_eq!(
            get_logs().last().unwrap(),
            r#"EVENT_JSON:{"standard":"gateflow","version":"1.0.0","event":"payment_opened","data":[{"payment":0,"invoice":0,"gateway":0}]}"#
        );
        let (to, method, args, deposit) = calls()[0].clone();
        assert_eq!((to.as_str(), method.as_str(), deposit), ("outlayer.near", "request_execution", NearToken::from_millinear(10)));
        assert_eq!(args["source"], json!({"Project": {"project_id": "ops.near/gateflow", "version_key": null}}));
        assert_eq!(args["secrets_ref"], json!({"profile": "default", "account_id": "ops.near"}));
        assert_eq!(args["response_format"], "Json");
        // OutLayer workers drop a request whose limits are `{}` (out-layer/outlayer#31).
        assert_eq!(args["resource_limits"], json!({"max_instructions": 1_000_000_000u64, "max_memory_mb": 128, "max_execution_seconds": 60}));
        let input: near_sdk::serde_json::Value = near_sdk::serde_json::from_str(args["input_data"].as_str().unwrap()).unwrap();
        assert_eq!(input, json!({"kind": "screen", "payer": payer(), "max_risk": 50}));
        assert!(calls().iter().any(|(_, m, a, _)| m == "on_screened" && a == &json!({"payment": 0})));

        assert_eq!(c.get_payments(0, 0, 10).len(), 1);
        assert!(c.get_payment(9).is_none());
        assert!(c.get_payments(42, 0, 10).is_empty());
    }

    #[test]
    fn refund_to_from_msg() {
        let mut c = with_invoice();
        pay(&mut c, &usdc(), &payer(), TEN_USDC, r#"{"invoice":0,"refund_to":"bob.near"}"#, T0);
        assert_eq!(c.get_payment(0).unwrap().refund_to.as_str(), "bob.near");
    }

    const REF_MSG: &str = r#"{"invoice":0,"ref":"r1","refund_to":"bob.near"}"#;

    #[test]
    fn ref_payment_opens_pending_without_fuel() {
        let mut c = with_invoice();
        assert_eq!(pay(&mut c, &usdc(), &intents(), TEN_USDC, REF_MSG, T0), 0);
        let p = c.get_payment(0).unwrap();
        assert_eq!((p.status, p.reference.as_deref()), (PaymentStatus::Pending, Some("r1")));
        assert_eq!((p.payer.clone(), p.refund_to.as_str()), (intents(), "bob.near"));
        let i = c.get_invoice(0).unwrap();
        assert_eq!((i.status, i.payment), (InvoiceStatus::Paying, Some(0)));
        assert_eq!(c.get_gateway(0).unwrap().fuel, NearToken::from_millinear(50));
        assert!(calls().is_empty());
        assert_eq!(
            get_logs(),
            vec![r#"EVENT_JSON:{"standard":"gateflow","version":"1.0.0","event":"payment_opened","data":[{"payment":0,"invoice":0,"gateway":0,"ref":"r1"}]}"#]
        );
    }

    #[test]
    fn ref_from_other_sender_rejected() {
        let mut c = with_invoice();
        let res = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            pay(&mut c, &usdc(), &"alice.near".parse().unwrap(), TEN_USDC, REF_MSG, T0)
        }));
        let err = *res.unwrap_err().downcast::<String>().unwrap();
        assert!(err.contains("ref payments only from intents.near"), "{err}");
        assert!(c.get_payment(0).is_none());
    }

    #[test]
    fn duplicate_ref_refunds() {
        let mut c = with_invoice();
        pay(&mut c, &usdc(), &intents(), TEN_USDC, REF_MSG, T0);
        as_caller(&merchant());
        c.create_invoice(0, usdc(), near_sdk::json_types::U128(TEN_USDC), 3600, None);
        let msg = r#"{"invoice":1,"ref":"r1","refund_to":"bob.near"}"#;
        assert_eq!(pay(&mut c, &usdc(), &intents(), TEN_USDC, msg, T0), 0);
        assert_eq!(c.get_payment(1).unwrap().status, PaymentStatus::Refunded);
        let i = c.get_invoice(1).unwrap();
        assert_eq!((i.status, i.payment), (InvoiceStatus::Open, None));
        let logs = get_logs();
        assert_eq!(logs.len(), 2);
        assert!(logs[0].contains(r#""event":"payment_opened""#) && logs[1].contains(r#""event":"payment_closed""#));
        assert!(logs[1].contains(r#""status":"Refunded""#));
        assert_eq!(ft_transfer(), (usdc(), "bob.near".to_string(), TEN_USDC.to_string()));
        assert_eq!(c.get_payment_by_ref("r1".into()).unwrap().0, 0);
    }

    #[test]
    fn second_ref_payment_refunds_keeps_invoice() {
        let mut c = with_invoice();
        pay(&mut c, &usdc(), &intents(), TEN_USDC, REF_MSG, T0);
        let msg = r#"{"invoice":0,"ref":"r2","refund_to":"bob.near"}"#;
        assert_eq!(pay(&mut c, &usdc(), &intents(), TEN_USDC, msg, T0), 0);
        assert_eq!(c.get_payment(1).unwrap().status, PaymentStatus::Refunded);
        let i = c.get_invoice(0).unwrap();
        assert_eq!((i.status, i.payment), (InvoiceStatus::Paying, Some(0)));
    }

    #[test]
    fn expired_invoice_with_ref_refunds() {
        let mut c = with_invoice();
        assert_eq!(pay(&mut c, &usdc(), &intents(), TEN_USDC, REF_MSG, T0 + 3600), 0);
        assert_eq!(c.get_payment(0).unwrap().status, PaymentStatus::Refunded);
        assert_eq!(c.get_invoice(0).unwrap().status, InvoiceStatus::Open);
    }

    #[test]
    fn ref_amount_mismatch_refunds() {
        let mut c = with_invoice();
        assert_eq!(pay(&mut c, &usdc(), &intents(), TEN_USDC - 1, REF_MSG, T0), 0);
        let p = c.get_payment(0).unwrap();
        assert_eq!((p.status, p.amount.0), (PaymentStatus::Refunded, TEN_USDC - 1));
        assert_eq!(ft_transfer().2, (TEN_USDC - 1).to_string());
    }

    #[test]
    fn msg_with_gateway_field_accepted() {
        let mut c = with_invoice();
        pay(&mut c, &usdc(), &intents(), TEN_USDC, r#"{"gateway":0,"invoice":0,"ref":"r2"}"#, T0);
        assert_eq!(c.get_payment(0).unwrap().status, PaymentStatus::Pending);
    }

    #[test]
    fn payment_lookup_by_ref() {
        let mut c = with_invoice();
        pay(&mut c, &usdc(), &intents(), TEN_USDC, REF_MSG, T0);
        assert_eq!(c.get_payment_by_ref("r1".into()), Some((0, c.get_payment(0).unwrap())));
        assert!(c.get_payment_by_ref("nope".into()).is_none());
    }

    #[test]
    fn oversized_ref_refunds_without_storing_it() {
        let mut c = with_invoice();
        let msg = format!(r#"{{"invoice":0,"ref":"{}","refund_to":"bob.near"}}"#, "r".repeat(65));
        assert_eq!(pay(&mut c, &usdc(), &intents(), TEN_USDC, &msg, T0), 0);
        let p = c.get_payment(0).unwrap();
        assert_eq!((p.status, p.reference), (PaymentStatus::Refunded, None));
        assert_eq!(c.get_invoice(0).unwrap().status, InvoiceStatus::Open);
        assert!(c.get_payment_by_ref("r".repeat(65)).is_none());
    }
}
