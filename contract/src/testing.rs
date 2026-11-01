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

pub fn usdc() -> AccountId {
    "usdc.near".parse().unwrap()
}

/// `with_gateway()` plus USDC on the allowlist; the next caller is `merchant()`.
pub fn with_usdc() -> Gateflow {
    let mut c = with_gateway();
    as_caller(&op());
    c.add_token(usdc());
    as_caller(&merchant());
    c
}

pub const TEN_USDC: u128 = 10_000_000;

/// `with_usdc()` plus invoice 0: 10 USDC on gateway 0, expiring at `T0 + 3600`.
pub fn with_invoice() -> Gateflow {
    let mut c = with_usdc();
    c.create_invoice(0, usdc(), near_sdk::json_types::U128(TEN_USDC), 3600, None);
    c
}

pub fn payer() -> AccountId {
    "0x1111111111111111111111111111111111111111".parse().unwrap()
}

/// `ft_on_transfer` as called by `token` at `at_sec`; returns the unused amount.
pub fn pay(c: &mut Gateflow, token: &AccountId, sender: &AccountId, amount: u128, msg: &str, at_sec: u64) -> u128 {
    call(token, NearToken::from_yoctonear(0), at_sec);
    match c.ft_on_transfer(sender.clone(), near_sdk::json_types::U128(amount), msg.to_string()) {
        near_sdk::PromiseOrValue::Value(v) => v.0,
        near_sdk::PromiseOrValue::Promise(_) => panic!("ft_on_transfer must return a value"),
    }
}

/// Function calls created by the last contract call: (receiver, method, args, deposit).
pub fn calls() -> Vec<(AccountId, String, near_sdk::serde_json::Value, NearToken)> {
    near_sdk::test_utils::get_created_receipts()
        .into_iter()
        .flat_map(|r| {
            let to = r.receiver_id.clone();
            r.actions.into_iter().filter_map(move |a| match a {
                near_sdk::mock::MockAction::FunctionCallWeight { method_name, args, attached_deposit, .. } => Some((
                    to.clone(),
                    String::from_utf8(method_name).unwrap(),
                    near_sdk::serde_json::from_slice(&args).unwrap_or(near_sdk::serde_json::Value::Null),
                    attached_deposit,
                )),
                _ => None,
            })
        })
        .collect()
}

/// Resumes as a callback on this contract at `at_sec`, with `result` as promise result 0.
pub fn as_callback(result: near_sdk::PromiseResult, at_sec: u64) {
    let ctx = VMContextBuilder::new()
        .predecessor_account_id(near_sdk::test_utils::accounts(0)) // the contract's own account in tests
        .current_account_id(near_sdk::test_utils::accounts(0))
        .block_timestamp(at_sec * SEC)
        .build();
    testing_env!(ctx, near_sdk::test_vm_config(), near_sdk::RuntimeFeesConfig::test(), Default::default(), vec![result]);
}

pub fn ok(bytes: &[u8]) -> near_sdk::PromiseResult {
    near_sdk::PromiseResult::Successful(bytes.to_vec())
}

/// `with_invoice()` plus payment 0: a direct 10 USDC payment from `payer()` at `T0`, Pending.
pub fn with_payment() -> Gateflow {
    let mut c = with_invoice();
    pay(&mut c, &usdc(), &payer(), TEN_USDC, r#"{"invoice":0}"#, T0);
    c
}

/// The single `ft_transfer` the last call created: (token, receiver_id, amount).
pub fn ft_transfer() -> (AccountId, String, String) {
    let t: Vec<_> = calls().into_iter().filter(|(_, m, _, _)| m == "ft_transfer").collect();
    assert_eq!(t.len(), 1, "expected exactly one ft_transfer");
    let (token, _, args, deposit) = t[0].clone();
    assert_eq!(deposit, NearToken::from_yoctonear(1));
    (token, args["receiver_id"].as_str().unwrap().into(), args["amount"].as_str().unwrap().into())
}
