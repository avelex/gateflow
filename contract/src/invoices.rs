use crate::*;
use near_sdk::json_types::U128;
use near_sdk::serde_json::json;

pub const PAGE_LIMIT: u32 = 100;
pub const MIN_EXPIRY_SEC: u64 = 60;
pub const MAX_EXPIRY_SEC: u64 = 2_592_000;
pub const MAX_MEMO_BYTES: usize = 140;
/// Upper bound on one invoice's storage (memo <= 140 B, token <= 64 B, index entry, record
/// overheads). Fuel must cover it before anything is written; the measured usage is charged.
pub const MAX_INVOICE_STORAGE_BYTES: u128 = 512;

#[near]
impl Gateflow {
    /// Owner-only. Stores an Open invoice that fixes the token, amount and expiry a payer must
    /// match, and pays its storage from the gateway's fuel (design decision 12).
    pub fn create_invoice(
        &mut self,
        gateway: GatewayId,
        token: AccountId,
        amount: U128,
        expires_in_sec: u64,
        memo: Option<String>,
    ) -> InvoiceId {
        require!(self.tokens.contains(&token), "token not accepted");
        require!(amount.0 > 0, "amount must be positive");
        require!((MIN_EXPIRY_SEC..=MAX_EXPIRY_SEC).contains(&expires_in_sec), "invalid expiry");
        require!(memo.as_ref().map_or(0, |m| m.len()) <= MAX_MEMO_BYTES, "memo too long");
        let byte_cost = env::storage_byte_cost();
        let id = InvoiceId::from(self.invoices.len());
        let g = self.owned_gateway_mut(gateway);
        require!(
            g.fuel >= byte_cost.saturating_mul(MAX_INVOICE_STORAGE_BYTES),
            "gateway has no fuel for invoice storage"
        );
        let slot = g.invoices;
        g.invoices += 1;
        let start = env::storage_usage();
        self.invoice_index.insert((gateway, slot), id);
        self.invoices.push(Invoice {
            gateway,
            token,
            amount,
            expires_at_sec: now_sec() + expires_in_sec,
            memo,
            status: InvoiceStatus::Open,
            payment: None,
        });
        // store collections write on flush; flush now so the usage can be measured and charged.
        self.invoice_index.flush();
        self.invoices.flush();
        let cost = byte_cost.saturating_mul(u128::from(env::storage_usage().saturating_sub(start)));
        let g = self.gateway_mut(gateway);
        g.fuel = g.fuel.saturating_sub(cost);
        events::emit("invoice_created", json!({"invoice": id, "gateway": gateway}));
        id
    }

    pub fn get_invoice(&self, invoice: InvoiceId) -> Option<Invoice> {
        u32::try_from(invoice).ok().and_then(|i| self.invoices.get(i)).cloned()
    }

    pub fn get_invoices(&self, gateway: GatewayId, from_index: u32, limit: u32) -> Vec<(InvoiceId, Invoice)> {
        let count = self.gateways.get(gateway).map_or(0, |g| g.invoices);
        page(&self.invoice_index, gateway, count, from_index, limit)
            .into_iter()
            .map(|id| (id, self.get_invoice(id).unwrap()))
            .collect()
    }
}

pub(crate) fn now_sec() -> u64 {
    env::block_timestamp() / 1_000_000_000
}

/// Ids stored in a per-gateway index for slots `from_index..min(from_index + min(limit, 100), count)`.
pub(crate) fn page(index: &LookupMap<(GatewayId, u32), u64>, gateway: GatewayId, count: u32, from_index: u32, limit: u32) -> Vec<u64> {
    let end = from_index.saturating_add(limit.min(PAGE_LIMIT)).min(count);
    (from_index..end).filter_map(|slot| index.get(&(gateway, slot)).copied()).collect()
}

#[cfg(test)]
mod tests {
    use crate::testing::*;
    use crate::InvoiceStatus;
    use near_sdk::json_types::U128;
    use near_sdk::test_utils::{accounts, get_logs};
    use near_sdk::NearToken;

    fn invoice(c: &mut crate::Gateflow, expires_in_sec: u64) -> u64 {
        c.create_invoice(0, usdc(), U128(10_000_000), expires_in_sec, None)
    }

    #[test]
    fn invoice_created() {
        let mut c = with_usdc();
        assert_eq!(c.create_invoice(0, usdc(), U128(10_000_000), 3600, Some("order 1".into())), 0);
        let i = c.get_invoice(0).unwrap();
        assert_eq!(i.status, InvoiceStatus::Open);
        assert_eq!(i.expires_at_sec, T0 + 3600);
        assert_eq!((i.gateway, i.amount, i.payment), (0, U128(10_000_000), None));
        assert_eq!(i.memo.as_deref(), Some("order 1"));
        assert_eq!(
            get_logs().last().unwrap(),
            r#"EVENT_JSON:{"standard":"gateflow","version":"1.0.0","event":"invoice_created","data":[{"invoice":0,"gateway":0}]}"#
        );
        assert_eq!(c.get_gateway(0).unwrap().invoices, 1);
    }

    #[test]
    #[should_panic(expected = "not the gateway owner")]
    fn non_owner_cannot_invoice() {
        let mut c = with_usdc();
        as_caller(&accounts(2));
        invoice(&mut c, 3600);
    }

    #[test]
    #[should_panic(expected = "token not accepted")]
    fn invoice_token_not_accepted() {
        let mut c = with_usdc();
        c.create_invoice(0, "nbtc.bridge.near".parse().unwrap(), U128(1), 3600, None);
    }

    #[test]
    #[should_panic(expected = "amount must be positive")]
    fn invoice_zero_amount() {
        let mut c = with_usdc();
        c.create_invoice(0, usdc(), U128(0), 3600, None);
    }

    #[test]
    #[should_panic(expected = "invalid expiry")]
    fn invoice_expiry_too_short() {
        let mut c = with_usdc();
        invoice(&mut c, 59);
    }

    #[test]
    #[should_panic(expected = "invalid expiry")]
    fn invoice_expiry_too_long() {
        let mut c = with_usdc();
        invoice(&mut c, 3_000_000);
    }

    #[test]
    #[should_panic(expected = "memo too long")]
    fn invoice_memo_too_long() {
        let mut c = with_usdc();
        c.create_invoice(0, usdc(), U128(1), 3600, Some("x".repeat(141)));
    }

    #[test]
    fn invoice_bounds_accepted() {
        let mut c = with_usdc();
        invoice(&mut c, 60);
        invoice(&mut c, 2_592_000);
        c.create_invoice(0, usdc(), U128(1), 3600, Some("x".repeat(140)));
        assert_eq!(c.get_gateway(0).unwrap().invoices, 3);
    }

    #[test]
    fn invoices_page() {
        let mut c = with_usdc();
        for _ in 0..5 {
            invoice(&mut c, 3600);
        }
        let ids: Vec<u64> = c.get_invoices(0, 3, 10).into_iter().map(|(id, _)| id).collect();
        assert_eq!(ids, vec![3, 4]);
        assert!(c.get_invoices(0, 5, 10).is_empty());
    }

    #[test]
    fn invoices_limit_capped() {
        let mut c = with_usdc();
        top_up(&mut c, NearToken::from_near(1)); // fuel for 101 invoices' storage
        for _ in 0..101 {
            as_caller(&merchant()); // one call per invoice; a single call may log at most 100 times
            invoice(&mut c, 3600);
        }
        assert_eq!(c.get_invoices(0, 0, 500).len(), 100);
    }

    #[test]
    fn invoices_unknown_gateway_empty() {
        let mut c = with_usdc();
        invoice(&mut c, 3600);
        assert!(c.get_invoices(42, 0, 10).is_empty());
        assert!(c.get_invoice(9).is_none());
    }

    #[test]
    fn expired_invoice_reads_open() {
        let mut c = with_usdc();
        invoice(&mut c, 60);
        call(&merchant(), NearToken::from_yoctonear(0), T0 + 61);
        let i = c.get_invoice(0).unwrap();
        assert_eq!(i.status, InvoiceStatus::Open);
        assert!(i.expires_at_sec < T0 + 61);
    }

    #[test]
    fn invoice_storage_paid_from_fuel() {
        let mut c = with_usdc();
        let before = (c.get_gateway(0).unwrap().fuel, near_sdk::env::storage_usage());
        invoice(&mut c, 3600);
        let after = (c.get_gateway(0).unwrap().fuel, near_sdk::env::storage_usage());
        let cost = near_sdk::env::storage_byte_cost().saturating_mul(u128::from(after.1 - before.1));
        assert!(cost > NearToken::from_yoctonear(0) && cost < NearToken::from_millinear(10), "{cost}");
        assert_eq!(after.0, before.0.saturating_sub(cost));
    }

    #[test]
    fn invoice_without_storage_fuel_rejected() {
        let mut c = setup();
        call(&merchant(), NearToken::from_millinear(10), T0);
        c.create_gateway(merchant(), policy(50));
        as_caller(&op());
        c.add_token(usdc());
        let mut created = 0;
        let err = loop {
            as_caller(&merchant());
            let res = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                c.create_invoice(0, usdc(), U128(1), 3600, Some("x".repeat(140)));
            }));
            match res {
                Ok(()) => created += 1,
                Err(e) => break *e.downcast::<String>().unwrap(),
            }
            assert!(created < 10, "fuel never ran out");
        };
        assert!(err.contains("gateway has no fuel for invoice storage"), "{err}");
        assert!(created >= 1);
        assert_eq!(c.get_gateway(0).unwrap().invoices, created);
    }
}
