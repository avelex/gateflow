# Gateflow Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. OpenSpec tracks only the `- [ ] N.M` lines; the numbered steps under each task are its TDD cycle and are not tracked separately.

**Goal:** Write the Gateflow NEAR contract from scratch: an escrow that holds each invoice payment until the OutLayer enclave screens the payer, then settles to the merchant or refunds the payer, with no operator path to funds.

**Architecture:** One `near-sdk` 5 contract in `contract/`, split by responsibility: state and operator (`lib.rs`), types (`types.rs`), events (`events.rs`), gateways, invoices, payment intake, screening, and closing in their own modules. Every token transfer is built in one function, `close`. Callbacks are guarded by the payment's Pending status.

**Tech Stack:** Rust, `near-sdk` 5 (latest 5.x, features `unit-testing` for dev), `serde_json`; unit tests with `testing_env!` and `VMContextBuilder`.

**Spec:** `openspec/specs/{payment-clearing,merchant-gateways,invoices}/spec.md`, the deltas in `openspec/changes/contract-from-scratch/specs/`, and `openspec/changes/contract-from-scratch/design.md`.

## Global Constraints

- Release build: `cd contract && cargo build --target wasm32-unknown-unknown --release`. Tests: `cd contract && cargo test`. No warnings.
- Deployable wasm: `cd contract && cargo near build non-reproducible-wasm` → `contract/target/near/gateflow.wasm`. The toolchain is pinned to Rust 1.86.0 in `contract/rust-toolchain.toml`, because wasm from rustc 1.87 or newer is rejected by the nearcore VM (cargo-near 0.19).
- No method deploys code, adds or deletes access keys, or deletes the account. Only `close` and `retry` build `ft_transfer`.
- Constants: `CLEARING_WINDOW_SEC = 900`, `MAX_RISK_CAP = 80`, `PAGE_LIMIT = 100`, `MIN_EXPIRY_SEC = 60`, `MAX_EXPIRY_SEC = 2_592_000`, `MAX_MEMO_BYTES = 140`, `SCREENED_CALLBACK_GAS = 40 Tgas`, `CLOSED_CALLBACK_GAS = 10 Tgas`, `FT_TRANSFER_GAS = 10 Tgas`.
- `ref` = the JSON key `"ref"`; Rust field `reference` with `#[serde(rename = "ref")]`.
- Ids: `GatewayId = u32`, `InvoiceId = u64`, `PaymentId = u64`, all vector indexes. Amounts are `U128` in JSON.
- Panic messages (exact): "not the operator", "not the gateway owner", "unknown gateway", "risk cap too high", "token not accepted", "amount must be positive", "unknown invoice", "invoice is not open", "invoice expired", "wrong token for this invoice", "amount does not match the invoice", "invalid expiry", "memo too long", "gateway has no fuel for screening", "ref payments only from intents.near", "unknown payment", "payment has no ref", "screening already started", "clearing window is still open", "payment has no failed transfer".
- Events: `EVENT_JSON:{"standard":"gateflow","version":"1.0.0","event":<name>,"data":[{...}]}`.
- Commits: short conventional style, one per task (`feat(contract): …`).

## Review Focus

- A verdict arriving after `reclaim` already refunded must be ignored, with no second transfer. Test `late_verdict_after_reclaim_ignored` (4.1).
- A payer paying the same invoice twice through 1Click: the second `ref` payment refunds and the invoice keeps the first payment. Test `second_ref_payment_refunds_keeps_invoice` (5.1).
- The relay still sends `gateway` inside `msg`: it must be ignored, not rejected. Test `msg_with_gateway_field_accepted` (5.1).
- An invoice whose expiry equals the block time is already expired. Test `invoice_expired_at_boundary` (3.1).
- `retry` called twice on one failed payment: the second call fails, so only one transfer is in flight. Test `retry_twice_fails` (4.2).

---

## 1. Spike and crate skeleton

- [x] 1.1 Confirm the OutLayer and 1Click facts the design leaves open, and record them in `design.md` as decision 10, removing both Open Questions; verify the decision lists the `request_execution` method name, its argument JSON, the attached deposit, how the verdict reaches the callback, and the `sender_id` of one recorded mainnet 1Click delivery
  1. Read the OutLayer contract docs or source for the execution request call. Record the exact method, its args (project, input JSON, `secrets_ref`), the deposit and gas, and the shape of the callback result: the bytes of the verdict, and what a failed or timed-out execution looks like.
  2. Find one mainnet `ft_transfer_call` from 1Click to any contract in a NEAR explorer (receiver `*.omft.near` or USDC with a `customRecipientMsg`). Record its `sender_id`. If it is not `intents.near`, stop and revisit the `ref` sender rule with the user.
  3. Commit `docs(openspec): record OutLayer call shape`.
- [x] 1.2 Create the crate with state, `new`, the operator methods and the event helper; verify `cargo test` passes the six tests below and the release build succeeds

  **Files:** create `contract/Cargo.toml` (`crate-type = ["cdylib", "rlib"]`, release profile `opt-level = "z"`, `lto = true`, `overflow-checks = true`, `panic = "abort"`), `contract/src/lib.rs`, `contract/src/types.rs`, `contract/src/events.rs`, `contract/.gitignore` (`target/`).
  **Interfaces (produces):**
  - `types.rs`: `Policy { max_risk: u8 }`, `Gateway`, `Invoice`, `InvoiceStatus { Open, Paying, Paid, Returned }`, `Payment`, `PaymentStatus { Pending, Settled, Refunded, SettleFailed, RefundFailed }`, `PayMsg { invoice: InvoiceId, refund_to: Option<AccountId>, reference: Option<String> }`, field sets as in design decision 1.
  - `lib.rs`: `#[init] fn new(operator: AccountId, intents: AccountId, outlayer: AccountId, project: String, execution_deposit: NearToken) -> Self`; `fn set_operator(&mut self, operator: AccountId)`, `fn add_token(&mut self, token: AccountId)`, `fn remove_token(&mut self, token: AccountId)`, `fn set_enclave(&mut self, outlayer: AccountId, project: String)`, views `get_operator() -> AccountId`, `get_tokens() -> Vec<AccountId>`; private helper `fn assert_operator(&self)`.
  - `events.rs`: `pub fn emit(event: &str, data: serde_json::Value)`.

  1. Write the failing tests in `lib.rs`:
     - `operator_rotated`: `set_operator("ops2.near")` by the operator, then `get_operator() == "ops2.near"` and `add_token` by the old operator panics "not the operator".
     - `non_operator_rejected`: `#[should_panic(expected = "not the operator")]` on `add_token` from `alice.near`. Repeat as `non_operator_cannot_set_enclave` and `non_operator_cannot_set_operator`.
     - `add_and_remove_token`: `add_token("nbtc.bridge.near")` then `get_tokens() == ["nbtc.bridge.near"]`; after `remove_token` it is empty.
     - `event_format` (in `events.rs`): `emit("invoice_created", json!({"invoice":0,"gateway":0}))`, then `get_logs()[0] == r#"EVENT_JSON:{"standard":"gateflow","version":"1.0.0","event":"invoice_created","data":[{"gateway":0,"invoice":0}]}"#` (serde_json orders keys alphabetically).
  2. Run `cargo test`. Expected: compile errors.
  3. Implement. Collections use `near_sdk::store` with one storage prefix per field.
  4. Run `cargo test` (6 passed) and the release build.
  5. Commit `feat(contract): state, operator role and events`.

## 2. Gateways and invoices

- [x] 2.1 Add gateways in `contract/src/gateways.rs`; verify `cargo test` passes the five tests below

  **Interfaces (produces):** `#[payable] fn create_gateway(&mut self, payout_to: AccountId, policy: Policy) -> GatewayId`, `fn set_policy(&mut self, gateway: GatewayId, policy: Policy)`, `#[payable] fn fund(&mut self, gateway: GatewayId)`, `fn get_gateway(&self, gateway: GatewayId) -> Option<Gateway>`, helper `fn gateway_mut(&mut self, id) -> &mut Gateway` (panics "unknown gateway").

  1. Write the failing tests:
     - `gateway_created_with_fuel`: attach 0.05 NEAR → id 0, owner = caller, `fuel == 0.05 NEAR`, `invoices == 0`, `payments == 0`.
     - `risk_cap_too_high`: `max_risk = 90` → panic "risk cap too high", both in `create_gateway` and in `set_policy`.
     - `risk_cap_accepted`: `max_risk = 80` → created.
     - `non_owner_cannot_set_policy`: panic "not the gateway owner".
     - `fund_adds_fuel`: `fund(0)` with 0.1 NEAR from any account → fuel grows by 0.1 NEAR; `get_gateway(42)` is `None`.
  2. Run: FAIL. 3. Implement. 4. Run: 5 passed. 5. Commit `feat(contract): gateways`.
- [x] 2.2 Add invoices in `contract/src/invoices.rs`; verify `cargo test` passes the six tests below

  **Interfaces (produces):** `fn create_invoice(&mut self, gateway: GatewayId, token: AccountId, amount: U128, expires_in_sec: u64, memo: Option<String>) -> InvoiceId`, `fn get_invoice(&self, invoice: InvoiceId) -> Option<Invoice>`, `fn get_invoices(&self, gateway: GatewayId, from_index: u32, limit: u32) -> Vec<(InvoiceId, Invoice)>`, helper `fn now_sec() -> u64` (block timestamp / 1e9).

  1. Write the failing tests:
     - `invoice_created`: owner creates 10 USDC (`amount = 10_000_000`) expiring in 3600 s → id 0, Open, `expires_at_sec == now + 3600`, log `invoice_created {invoice:0, gateway:0}`, `get_gateway(0).invoices == 1`.
     - `non_owner_cannot_invoice`: panic "not the gateway owner".
     - `invoice_validation`: unlisted token → "token not accepted"; amount 0 → "amount must be positive"; `expires_in_sec` 59 and 3_000_000 → "invalid expiry"; 141-byte memo → "memo too long". One `#[should_panic]` test per message.
     - `invoices_page`: 5 invoices, `get_invoices(0, 3, 10)` returns ids 3 and 4.
     - `invoices_limit_capped`: 101 invoices, `get_invoices(0, 0, 500).len() == 100`.
     - `invoices_unknown_gateway_empty`: `get_invoices(42, 0, 10)` is empty, and `get_invoice(9)` is `None`.
     - `expired_invoice_reads_open`: past expiry, `get_invoice(0)` is Open with `expires_at_sec` in the past.
  2. Run: FAIL. 3. Implement; paging walks `invoice_index` slots `from_index..min(from_index + min(limit, 100), count)`. 4. Run: 7 passed (plus the per-message panics). 5. Commit `feat(contract): invoices`.

## 3. Direct payments

- [x] 3.1 Accept direct payments in `contract/src/payments.rs` (`ft_on_transfer`, no `ref`) and request screening through `contract/src/screening.rs`; verify `cargo test` passes the tests below and the release build succeeds

  **Interfaces:**
  - Consumes: decision 10 from 1.1 (OutLayer call shape); `gateway_mut`, `now_sec`, `events::emit`.
  - Produces: `fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> PromiseOrValue<U128>` (always `U128(0)` when it returns), `fn open_payment(&mut self, ...) -> PaymentId` (records, indexes, emits `payment_opened`), `fn check_invoice(&self, invoice: &Invoice, token: &AccountId, amount: U128) -> Result<(), &'static str>` (returns one of the invoice panic messages), `fn get_payment(&self, payment: PaymentId) -> Option<Payment>`, `fn get_payments(&self, gateway: GatewayId, from_index: u32, limit: u32) -> Vec<(PaymentId, Payment)>`; in `screening.rs`: `fn request_screening(&self, payment: PaymentId, request: serde_json::Value) -> Promise` (OutLayer call with `execution_deposit`, then `on_screened(payment)` with `SCREENED_CALLBACK_GAS`). Request JSON: `{"kind":"screen","payer":<sender>,"max_risk":<n>}`.

  1. Write the failing tests (predecessor = the token contract):
     - `wrong_token_rejected`: "token not accepted".
     - `malformed_msg_rejected`: `msg = "x"` panics.
     - `payment_without_invoice`: `msg = {"refund_to":"bob.near"}` panics and `get_payments(0,0,10)` is empty.
     - `unknown_invoice`: "unknown invoice".
     - `amount_mismatch`: 9 USDC for a 10 USDC invoice → "amount does not match the invoice"; wrong token → "wrong token for this invoice".
     - `invoice_expired_at_boundary`: block time = `expires_at_sec` → "invoice expired".
     - `second_payment_while_paying`: "invoice is not open".
     - `no_fuel_rejected`: gateway fuel below the execution deposit → "gateway has no fuel for screening".
     - `removed_token_rejects_new_payment`: `remove_token(USDC)` after the invoice was created → "token not accepted".
     - `direct_payment_opens`: returns `U128(0)`; payment Pending with `refund_to == sender`, `invoice == 0`, `max_risk` from the policy; invoice Paying with `payment == Some(0)`; fuel dropped by one deposit; logs `payment_opened`; `get_payments(0,0,10).len() == 1`; `get_gateway(0).payments == 1`; `get_payment(9)` is `None`; `get_payments(42,0,10)` is empty.
  2. Run: FAIL. 3. Implement the no-`ref` branch in the order of design decision 3. 4. Run: all pass, release build ok. 5. Commit `feat(contract): accept direct invoice payments`.
## 4. Closing payments

- [x] 4.1 Add `close`, `on_screened` and `reclaim` in `contract/src/closing.rs`; verify `cargo test` passes the tests below

  **Interfaces (produces):** `fn close(&mut self, payment: PaymentId, approved: bool) -> Promise` (sets Settled or Refunded, moves the invoice to Paid or Returned, emits `payment_closed`, returns `ft_transfer(receiver, amount)` with 1 yocto and `FT_TRANSFER_GAS`, then `on_closed(payment)` with `CLOSED_CALLBACK_GAS`); `#[private] fn on_screened(&mut self, payment: PaymentId) -> PromiseOrValue<()>`; `fn reclaim(&mut self, payment: PaymentId) -> Promise`.

  1. Write the failing tests (set promise results with `testing_env!`):
     - `approved_settles`: result `true` → Settled, invoice Paid, receiver `payout_to`.
     - `rejected_refunds`: result `false` → Refunded, invoice Returned, receiver `refund_to`, fuel unchanged.
     - `malformed_result_refunds`: result `"yes"` → Refunded.
     - `enclave_failure_refunds_fuel`: `PromiseResult::Failed` → Refunded and fuel back up by one execution deposit.
     - `reclaim_window_open`: at +300 s → "clearing window is still open".
     - `reclaim_refunds`: at +901 s → Refunded, invoice Returned.
     - `late_verdict_after_reclaim_ignored`: reclaim, then `on_screened` with `true` → still Refunded, no new promise, one `payment_closed` log in total.
     - `removed_token_still_settles`: `remove_token` while Pending, then `true` → `ft_transfer` goes to the payment's token.
  2. Run: FAIL. 3. Implement. 4. Run: all pass. 5. Commit `feat(contract): settle, refund and reclaim`.
- [x] 4.2 Add `on_closed` and `retry`; verify `cargo test` passes the tests below and that `grep -n "ft_transfer" contract/src/*.rs` shows the call built only in `closing.rs`

  **Interfaces (produces):** `#[private] fn on_closed(&mut self, payment: PaymentId)`; `fn retry(&mut self, payment: PaymentId) -> Promise`.

  1. Write the failing tests:
     - `failed_refund_marks_refund_failed`: `on_closed` with Failed after a refund → `RefundFailed`, log `transfer_failed {payment, receiver}`.
     - `failed_settle_marks_settle_failed`: same after settle → `SettleFailed`.
     - `successful_transfer_keeps_status`: Successful → status unchanged, no log.
     - `retry_resends_failed_refund`: `RefundFailed` → `retry` → Refunded and a new `ft_transfer` to `refund_to`.
     - `retry_twice_fails`: second `retry` before `on_closed` → "payment has no failed transfer".
     - `retry_on_settled_fails`: "payment has no failed transfer".
     - `operator_cannot_withdraw`: with a Pending payment, call every operator method; the receipt creates no `ft_transfer` action.
  2. Run: FAIL. 3. Implement. 4. Run: all pass, grep shows `closing.rs` only. 5. Commit `feat(contract): retry failed payout transfers`.

## 5. 1Click payments

- [x] 5.1 Accept 1Click `ref` payments and add `get_payment_by_ref`; update README's payment flow to the new `msg`; verify `cargo test` passes the tests below and README no longer shows `{gateway, invoice?` in the diagram

  **Interfaces:**
  - Consumes: `open_payment`, `check_invoice`, and `close(id, approved: bool) -> Promise` from 4.1.
  - Produces: `fn get_payment_by_ref(&self, reference: String) -> Option<(PaymentId, Payment)>`.

  1. Write the failing tests (sender = the `intents` account given to `new`):
     - `ref_payment_opens_pending_without_fuel`: Pending, `reference == Some("r1")`, invoice Paying, fuel unchanged, no promise to OutLayer.
     - `ref_from_other_sender_rejected`: sender `alice.near` → "ref payments only from intents.near", no payment recorded.
     - `duplicate_ref_refunds`: second payment with `ref = "r1"` → returns `U128(0)`, payment Refunded, its invoice unchanged, logs `payment_opened` then `payment_closed`.
     - `second_ref_payment_refunds_keeps_invoice`: invoice Paying with payment 0; a new `ref` payment for it → Refunded, invoice still `payment == Some(0)`.
     - `expired_invoice_with_ref_refunds`: refunded, invoice stays Open.
     - `msg_with_gateway_field_accepted`: `msg = {"gateway":0,"invoice":0,"ref":"r2"}` opens normally.
     - `payment_lookup_by_ref`: `get_payment_by_ref("r1") == Some((0, payment))`, unknown → `None`.
  2. Run: FAIL. 3. Implement the `ref` branch per design decision 3. In `README.md`, change the direct-payment `ft_transfer_call` msg to `{invoice, refund_to?}`, add `sender = intents.near` to the 1Click delivery line, and replace `gateway` with `invoice` in the enclave binding note. 4. Run: all pass. 5. Commit `feat(contract): accept 1Click ref payments`.

- [x] 5.2 Add `screen_intents` in `contract/src/screening.rs`; verify `cargo test` passes the five tests below and the release build succeeds

  **Interfaces:** Consumes `request_screening`. Produces `fn screen_intents(&mut self, payment: PaymentId, deposit_address: String) -> Promise`. Request JSON: `{"kind":"screen_intents","deposit_address":<s>,"invoice":<id>,"ref":<s>,"amount":<U128>,"max_risk":<n>}`.

  1. Write the failing tests:
     - `screen_intents_draws_fuel_and_stores_address`: fuel drops by one deposit, `deposit_address` stored, OutLayer promise created.
     - `screen_intents_twice_fails`: "screening already started", fuel drawn once.
     - `screen_intents_without_ref_fails`: "payment has no ref".
     - `screen_intents_without_fuel_fails`: "gateway has no fuel for screening", payment Pending.
     - `reclaim_after_screening_started`: started, +901 s → `reclaim` refunds.
  2. Run: FAIL. 3. Implement. 4. Run: all pass, release build ok. 5. Commit `feat(contract): deferred screening for 1Click payments`.

## 6. Review decisions

- [ ] 6.1 Restrict `screen_intents` to the relay (design decision 11); verify `cargo test` passes the tests below and `cargo near build non-reproducible-wasm` succeeds

  **Interfaces:** `new(operator: AccountId, relay: AccountId, intents: AccountId, enclave: Enclave, execution_deposit: NearToken)`; `fn set_relay(&mut self, relay: AccountId)` (operator only); view `get_relay() -> AccountId`.

  1. Write the failing tests:
     - `screen_intents_other_caller_rejected`: `alice.near` calls with `"wrong"` → "not the relay"; then the relay's call with `"dep1"` succeeds and fuel dropped once.
     - `relay_rotated`: `set_relay("relay2.near")` by the operator → `get_relay() == "relay2.near"`, the old relay gets "not the relay".
     - `non_operator_cannot_set_relay`: "not the operator".
     - Existing `screen_intents` tests call as the relay given to `new`.
  2. Run: FAIL. 3. Implement; the relay check comes first in `screen_intents`. 4. Run: all pass, build ok. 5. Commit `feat(contract): only the relay starts deferred screening`.
- [ ] 6.2 Charge merchants for their storage (design decision 12); verify `cargo test` passes the tests below and `cargo near build non-reproducible-wasm` succeeds

  1. Write the failing tests:
     - `gateway_without_fuel_rejected`: `create_gateway` with 9 milliNEAR (below the 10 milliNEAR execution deposit) → "attach at least one execution deposit".
     - `invoice_storage_paid_from_fuel`: fuel after `create_invoice` equals fuel before minus `storage_bytes * env::storage_byte_cost()`, and that cost is positive and below 0.01 NEAR.
     - `invoice_without_storage_fuel_rejected`: a gateway whose fuel was drawn down to below one invoice's cost → "gateway has no fuel for invoice storage", `get_gateway(0).invoices` unchanged.
     - Existing helpers that create gateways attach at least 10 milliNEAR.
  2. Run: FAIL. 3. Implement: measure `env::storage_usage()` around the writes in `create_invoice`; on shortfall `env::panic_str` so the writes roll back. 4. Run: all pass, build ok. 5. Commit `feat(contract): merchants pay invoice storage from fuel`.

## 7. Testnet integration

- [ ] 7.1 Deploy to a fresh testnet account with `new(...)`, `add_token` a test token, `storage_deposit` the contract on it, set the relay, then delete the account's full-access key; verify `near account list-keys <account>` shows no keys and `get_operator` returns the operator
- [ ] 7.2 Run one direct invoice payment from a named testnet account; verify through the explorer that the receipt chain is `ft_on_transfer` → OutLayer → `on_screened` → `ft_transfer` → `on_closed`, the payment ends `Refunded` (named accounts fail screening), the invoice is `Returned`, and the logs carry `payment_opened` and `payment_closed`; record the tx hash in `GOAL.md`

## Workflow follow-up

- Update `mainnet-launch` task 1.1 to include deleting the full-access key, and drop its `get_gateway` wording if it no longer fits.
- Enclave and relay follow-ups, outside this change: the enclave binding compares `invoice` instead of `gateway`, and the relay watcher parses NEP-297 events.
- Run `/opsx:archive contract-from-scratch` after review.
