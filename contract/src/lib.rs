pub mod events;
pub mod gateways;
pub mod types;

#[cfg(test)]
mod testing;

use near_sdk::store::{IterableSet, LookupMap, Vector};
use near_sdk::{env, near, require, AccountId, BorshStorageKey, NearToken, PanicOnDefault};
pub use types::*;

#[near]
#[derive(BorshStorageKey)]
enum Key {
    Tokens,
    Gateways,
    Invoices,
    Payments,
    Refs,
    InvoiceIndex,
    PaymentIndex,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Gateflow {
    operator: AccountId,
    /// The only account accepted as `sender_id` of a `ref` payment (`intents.near` on mainnet).
    intents: AccountId,
    enclave: Enclave,
    execution_deposit: NearToken,
    tokens: IterableSet<AccountId>,
    gateways: Vector<Gateway>,
    invoices: Vector<Invoice>,
    payments: Vector<Payment>,
    refs: LookupMap<String, PaymentId>,
    invoice_index: LookupMap<(GatewayId, u32), InvoiceId>,
    payment_index: LookupMap<(GatewayId, u32), PaymentId>,
}

#[near]
impl Gateflow {
    #[init]
    pub fn new(operator: AccountId, intents: AccountId, enclave: Enclave, execution_deposit: NearToken) -> Self {
        Self {
            operator,
            intents,
            enclave,
            execution_deposit,
            tokens: IterableSet::new(Key::Tokens),
            gateways: Vector::new(Key::Gateways),
            invoices: Vector::new(Key::Invoices),
            payments: Vector::new(Key::Payments),
            refs: LookupMap::new(Key::Refs),
            invoice_index: LookupMap::new(Key::InvoiceIndex),
            payment_index: LookupMap::new(Key::PaymentIndex),
        }
    }

    pub fn set_operator(&mut self, operator: AccountId) {
        self.assert_operator();
        self.operator = operator;
    }

    pub fn add_token(&mut self, token: AccountId) {
        self.assert_operator();
        self.tokens.insert(token);
    }

    pub fn remove_token(&mut self, token: AccountId) {
        self.assert_operator();
        self.tokens.remove(&token);
    }

    pub fn set_enclave(&mut self, enclave: Enclave) {
        self.assert_operator();
        self.enclave = enclave;
    }

    pub fn get_operator(&self) -> AccountId {
        self.operator.clone()
    }

    pub fn get_tokens(&self) -> Vec<AccountId> {
        self.tokens.iter().cloned().collect()
    }
}

impl Gateflow {
    fn assert_operator(&self) {
        require!(env::predecessor_account_id() == self.operator, "not the operator");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testing::*;
    use near_sdk::test_utils::accounts;

    #[test]
    fn operator_rotated() {
        let mut c = setup();
        c.set_operator("ops2.near".parse().unwrap());
        assert_eq!(c.get_operator(), "ops2.near".parse::<AccountId>().unwrap());
        let res = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            c.add_token("usdc.near".parse().unwrap())
        }));
        assert!(res.is_err());
    }

    #[test]
    #[should_panic(expected = "not the operator")]
    fn non_operator_rejected() {
        let mut c = setup();
        as_caller(&accounts(0));
        c.add_token("usdc.near".parse().unwrap());
    }

    #[test]
    #[should_panic(expected = "not the operator")]
    fn non_operator_cannot_set_enclave() {
        let mut c = setup();
        as_caller(&accounts(0));
        c.set_enclave(Enclave {
            outlayer: "evil.near".parse().unwrap(),
            project: "evil.near/x".into(),
            secrets_owner: accounts(0),
        });
    }

    #[test]
    #[should_panic(expected = "not the operator")]
    fn non_operator_cannot_set_operator() {
        let mut c = setup();
        as_caller(&accounts(0));
        c.set_operator(accounts(0));
    }

    #[test]
    fn add_and_remove_token() {
        let mut c = setup();
        c.add_token("nbtc.bridge.near".parse().unwrap());
        assert_eq!(c.get_tokens(), vec!["nbtc.bridge.near".parse::<AccountId>().unwrap()]);
        c.remove_token("nbtc.bridge.near".parse().unwrap());
        assert!(c.get_tokens().is_empty());
    }
}
