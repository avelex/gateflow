//! Unit-test helpers shared by every module.
use crate::{Enclave, Gateflow, Policy};
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::{testing_env, AccountId, NearToken};

pub const SEC: u64 = 1_000_000_000;
pub const T0: u64 = 1_700_000_000;

pub fn op() -> AccountId {
    "ops.near".parse().unwrap()
}

pub fn merchant() -> AccountId {
    "kaja.near".parse().unwrap()
}

/// Sets the next call's predecessor, attached deposit and block time (seconds).
pub fn call(caller: &AccountId, deposit: NearToken, at_sec: u64) {
    testing_env!(VMContextBuilder::new()
        .predecessor_account_id(caller.clone())
        .attached_deposit(deposit)
        .block_timestamp(at_sec * SEC)
        .build());
}

pub fn as_caller(caller: &AccountId) {
    call(caller, NearToken::from_yoctonear(0), T0);
}

pub fn setup() -> Gateflow {
    as_caller(&op());
    Gateflow::new(
        op(),
        "intents.near".parse().unwrap(),
        Enclave { outlayer: "outlayer.near".parse().unwrap(), project: "ops.near/gateflow".into(), secrets_owner: op() },
        NearToken::from_millinear(10),
    )
}

pub fn policy(max_risk: u8) -> Policy {
    Policy { max_risk }
}

/// Contract with gateway 0 owned by `merchant()`, fuel 0.05 NEAR, `max_risk` 50.
pub fn with_gateway() -> Gateflow {
    let mut c = setup();
    call(&merchant(), NearToken::from_millinear(50), T0);
    c.create_gateway(merchant(), policy(50));
    as_caller(&merchant());
    c
}
