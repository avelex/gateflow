//! The only exit for funds: every token transfer out of the contract is built in `transfer`.
use crate::invoices::now_sec;
use crate::*;
use near_sdk::serde_json::{self, json};
use near_sdk::{Gas, Promise, PromiseOrValue};

pub const CLEARING_WINDOW_SEC: u64 = 900;
pub const FT_TRANSFER_GAS: Gas = Gas::from_tgas(10);
pub const CLOSED_CALLBACK_GAS: Gas = Gas::from_tgas(10);
/// A screening verdict is the JSON `true` or `false`; anything longer is malformed.
const MAX_VERDICT_BYTES: usize = 64;

#[near]
impl Gateflow {
    /// OutLayer callback. Settles only on the JSON verdict `true`; refunds on anything else.
    /// A payment that is no longer Pending (for example after `reclaim`) ignores the verdict.
    #[private]
    pub fn on_screened(&mut self, payment: PaymentId) -> PromiseOrValue<()> {
        let p = self.payment(payment);
        if p.status != PaymentStatus::Pending {
            return PromiseOrValue::Value(());
        }
        let approved = match env::promise_result_checked(0, MAX_VERDICT_BYTES) {
            Ok(bytes) => matches!(serde_json::from_slice::<bool>(&bytes), Ok(true)),
            Err(_) => {
                // The execution did not run to a verdict: give the gateway its deposit back (design decision 10).
                let deposit = self.execution_deposit;
                let g = self.gateway_mut(p.gateway);
                g.fuel = g.fuel.saturating_add(deposit);
                false
            }
        };
        PromiseOrValue::Promise(self.close(payment, approved))
    }

    /// Anyone may refund a payment still Pending `CLEARING_WINDOW_SEC` after it opened.
    pub fn reclaim(&mut self, payment: PaymentId) -> Promise {
        let p = self.payment(payment);
        require!(p.status == PaymentStatus::Pending, "payment is not pending");
        require!(now_sec() >= p.opened_at_sec + CLEARING_WINDOW_SEC, "clearing window is still open");
        self.close(payment, false)
    }

    /// Token transfer callback. A failed transfer moves Settled to SettleFailed and Refunded to
    /// RefundFailed, so the funds stay retryable instead of looking delivered.
    #[private]
    pub fn on_closed(&mut self, payment: PaymentId) {
        if env::promise_result_checked(0, MAX_VERDICT_BYTES).is_ok() {
            return;
        }
        let p = self.payments.get_mut(payment as u32).unwrap();
        p.status = match p.status {
            PaymentStatus::Settled => PaymentStatus::SettleFailed,
            PaymentStatus::Refunded => PaymentStatus::RefundFailed,
            other => other,
        };
        let receiver = self.receiver(payment);
        events::emit("transfer_failed", json!({"payment": payment, "receiver": receiver}));
    }

    /// Anyone may resend a failed settle or refund to the same receiver.
    pub fn retry(&mut self, payment: PaymentId) -> Promise {
        let p = self.payments.get_mut(payment as u32).unwrap_or_else(|| env::panic_str("unknown payment"));
        p.status = match p.status {
            PaymentStatus::SettleFailed => PaymentStatus::Settled,
            PaymentStatus::RefundFailed => PaymentStatus::Refunded,
            _ => env::panic_str("payment has no failed transfer"),
        };
        self.transfer(payment)
    }
}

impl Gateflow {
    pub(crate) fn payment(&self, id: PaymentId) -> Payment {
        self.get_payment(id).unwrap_or_else(|| env::panic_str("unknown payment"))
    }

    /// Closes a Pending payment: Settled to the payout account when approved, otherwise Refunded
    /// to its refund account. The invoice follows only if this payment is the one it links.
    pub(crate) fn close(&mut self, id: PaymentId, approved: bool) -> Promise {
        let status = if approved { PaymentStatus::Settled } else { PaymentStatus::Refunded };
        let p = self.payments.get_mut(id as u32).unwrap();
        p.status = status;
        let invoice_id = p.invoice;
        if let Some(inv) = self.invoices.get_mut(invoice_id as u32) {
            if inv.payment == Some(id) {
                inv.status = if approved { InvoiceStatus::Paid } else { InvoiceStatus::Returned };
            }
        }
        events::emit("payment_closed", json!({"payment": id, "invoice": invoice_id, "status": status}));
        self.transfer(id)
    }

    /// The gateway's `payout_to` for a settle, the payment's `refund_to` for a refund.
    fn receiver(&self, id: PaymentId) -> AccountId {
        let p = self.payment(id);
        match p.status {
            PaymentStatus::Settled | PaymentStatus::SettleFailed => self.gateways.get(p.gateway).unwrap().payout_to.clone(),
            _ => p.refund_to,
        }
    }

    /// `ft_transfer` of the payment's amount in its token to its receiver, then `on_closed(id)`.
    pub(crate) fn transfer(&self, id: PaymentId) -> Promise {
        let p = self.payment(id);
        let receiver = self.receiver(id);
        Promise::new(p.token.clone())
            .function_call(
                "ft_transfer",
                json!({"receiver_id": receiver, "amount": p.amount}).to_string().into_bytes(),
                NearToken::from_yoctonear(1),
                FT_TRANSFER_GAS,
            )
            .then(Promise::new(env::current_account_id()).function_call(
                "on_closed",
                json!({"payment": id}).to_string().into_bytes(),
                NearToken::from_yoctonear(0),
                CLOSED_CALLBACK_GAS,
            ))
    }
}

#[cfg(test)]
mod tests {
    use crate::testing::*;
    use crate::{InvoiceStatus, PaymentStatus};
    use near_sdk::test_utils::get_logs;
    use near_sdk::{NearToken, PromiseResult};

    #[test]
    fn approved_settles() {
        let mut c = with_payment();
        as_callback(ok(b"true"), T0 + 30);
        let _ = c.on_screened(0);
        assert_eq!(c.get_payment(0).unwrap().status, PaymentStatus::Settled);
        assert_eq!(c.get_invoice(0).unwrap().status, InvoiceStatus::Paid);
        assert_eq!(ft_transfer(), (usdc(), merchant().to_string(), TEN_USDC.to_string()));
        assert!(calls().iter().any(|(_, m, a, _)| m == "on_closed" && a["payment"] == 0));
        assert_eq!(
            get_logs().last().unwrap(),
            r#"EVENT_JSON:{"standard":"gateflow","version":"1.0.0","event":"payment_closed","data":[{"payment":0,"invoice":0,"status":"Settled"}]}"#
        );
    }

    #[test]
    fn rejected_refunds() {
        let mut c = with_payment();
        as_callback(ok(b"false"), T0 + 30);
        let _ = c.on_screened(0);
        assert_eq!(c.get_payment(0).unwrap().status, PaymentStatus::Refunded);
        assert_eq!(c.get_invoice(0).unwrap().status, InvoiceStatus::Returned);
        assert_eq!(ft_transfer(), (usdc(), payer().to_string(), TEN_USDC.to_string()));
        assert_eq!(c.get_gateway(0).unwrap().fuel, NearToken::from_millinear(40));
    }

    #[test]
    fn malformed_result_refunds() {
        let mut c = with_payment();
        as_callback(ok(br#""yes""#), T0 + 30);
        let _ = c.on_screened(0);
        assert_eq!(c.get_payment(0).unwrap().status, PaymentStatus::Refunded);
    }

    #[test]
    fn enclave_failure_refunds_fuel() {
        let mut c = with_payment();
        as_callback(PromiseResult::Failed, T0 + 30);
        let _ = c.on_screened(0);
        assert_eq!(c.get_payment(0).unwrap().status, PaymentStatus::Refunded);
        assert_eq!(c.get_gateway(0).unwrap().fuel, NearToken::from_millinear(50));
    }

    #[test]
    #[should_panic(expected = "clearing window is still open")]
    fn reclaim_window_open() {
        let mut c = with_payment();
        call(&payer(), NearToken::from_yoctonear(0), T0 + 300);
        let _ = c.reclaim(0);
    }

    #[test]
    fn reclaim_refunds() {
        let mut c = with_payment();
        call(&payer(), NearToken::from_yoctonear(0), T0 + 901);
        let _ = c.reclaim(0);
        assert_eq!(c.get_payment(0).unwrap().status, PaymentStatus::Refunded);
        assert_eq!(c.get_invoice(0).unwrap().status, InvoiceStatus::Returned);
        assert_eq!(ft_transfer().1, payer().to_string());
    }

    #[test]
    #[should_panic(expected = "payment is not pending")]
    fn reclaim_closed_payment_fails() {
        let mut c = with_payment();
        call(&payer(), NearToken::from_yoctonear(0), T0 + 901);
        let _ = c.reclaim(0);
        call(&payer(), NearToken::from_yoctonear(0), T0 + 902);
        let _ = c.reclaim(0);
    }

    #[test]
    fn late_verdict_after_reclaim_ignored() {
        let mut c = with_payment();
        call(&payer(), NearToken::from_yoctonear(0), T0 + 901);
        let _ = c.reclaim(0);
        as_callback(ok(b"true"), T0 + 905);
        let _ = c.on_screened(0);
        assert_eq!(c.get_payment(0).unwrap().status, PaymentStatus::Refunded);
        assert!(calls().is_empty());
        assert!(get_logs().is_empty());
    }

    #[test]
    fn removed_token_still_settles() {
        let mut c = with_payment();
        as_caller(&op());
        c.remove_token(usdc());
        as_callback(ok(b"true"), T0 + 30);
        let _ = c.on_screened(0);
        assert_eq!(ft_transfer().0, usdc());
    }

    fn refunded() -> crate::Gateflow {
        let mut c = with_payment();
        as_callback(ok(b"false"), T0 + 30);
        let _ = c.on_screened(0);
        c
    }

    #[test]
    fn failed_refund_marks_refund_failed() {
        let mut c = refunded();
        as_callback(PromiseResult::Failed, T0 + 31);
        c.on_closed(0);
        assert_eq!(c.get_payment(0).unwrap().status, PaymentStatus::RefundFailed);
        assert_eq!(
            get_logs(),
            vec![format!(
                r#"EVENT_JSON:{{"standard":"gateflow","version":"1.0.0","event":"transfer_failed","data":[{{"payment":0,"receiver":"{}"}}]}}"#,
                payer()
            )]
        );
    }

    #[test]
    fn failed_settle_marks_settle_failed() {
        let mut c = with_payment();
        as_callback(ok(b"true"), T0 + 30);
        let _ = c.on_screened(0);
        as_callback(PromiseResult::Failed, T0 + 31);
        c.on_closed(0);
        assert_eq!(c.get_payment(0).unwrap().status, PaymentStatus::SettleFailed);
        assert_eq!(c.get_invoice(0).unwrap().status, InvoiceStatus::Paid);
    }

    #[test]
    fn successful_transfer_keeps_status() {
        let mut c = refunded();
        as_callback(ok(b""), T0 + 31);
        c.on_closed(0);
        assert_eq!(c.get_payment(0).unwrap().status, PaymentStatus::Refunded);
        assert!(get_logs().is_empty());
    }

    fn refund_failed() -> crate::Gateflow {
        let mut c = refunded();
        as_callback(PromiseResult::Failed, T0 + 31);
        c.on_closed(0);
        c
    }

    #[test]
    fn retry_resends_failed_refund() {
        let mut c = refund_failed();
        as_caller(&op());
        let _ = c.retry(0);
        assert_eq!(c.get_payment(0).unwrap().status, PaymentStatus::Refunded);
        assert_eq!(ft_transfer(), (usdc(), payer().to_string(), TEN_USDC.to_string()));
    }

    #[test]
    #[should_panic(expected = "payment has no failed transfer")]
    fn retry_twice_fails() {
        let mut c = refund_failed();
        as_caller(&op());
        let _ = c.retry(0);
        as_caller(&op());
        let _ = c.retry(0);
    }

    #[test]
    #[should_panic(expected = "payment has no failed transfer")]
    fn retry_on_settled_fails() {
        let mut c = with_payment();
        as_callback(ok(b"true"), T0 + 30);
        let _ = c.on_screened(0);
        as_caller(&payer());
        let _ = c.retry(0);
    }

    #[test]
    fn operator_cannot_withdraw() {
        let mut c = with_payment();
        let ops: Vec<Box<dyn Fn(&mut crate::Gateflow)>> = vec![
            Box::new(|c| c.add_token("nbtc.bridge.near".parse().unwrap())),
            Box::new(|c| c.remove_token(usdc())),
            Box::new(|c| {
                c.set_enclave(crate::Enclave {
                    outlayer: op(),
                    project: "ops.near/other".into(),
                    secrets_owner: op(),
                })
            }),
            Box::new(|c| c.set_operator(op())),
        ];
        for f in ops {
            as_caller(&op());
            f(&mut c);
            assert!(near_sdk::test_utils::get_created_receipts().is_empty());
        }
        assert_eq!(c.get_payment(0).unwrap().status, PaymentStatus::Pending);
    }
}
