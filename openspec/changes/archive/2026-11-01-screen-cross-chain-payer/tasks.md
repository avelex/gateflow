# Screen Cross-Chain Payer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. OpenSpec tracks only the `- [ ] N.M` lines; the numbered steps under each task are its TDD cycle and are not tracked separately.

**Goal:** Screen the origin-chain senders of 1Click payments from EVM chains, Bitcoin and transparent Zcash before Gateflow settles them, binding each NEAR payment to its 1Click deposit through a random `ref`.

**Architecture:** `ft_on_transfer` records `ref` payments without screening and never panics on them. A permissionless `screen_intents` call starts one OutLayer run. The enclave checks the 1Click status binding, finds the origin chain through `/v0/tokens`, resolves the senders with a per-chain resolver, and screens them: GoPlus for EVM, the OFAC list for BTC/ZEC. `on_screened` settles or refunds, and `on_closed` catches failed token transfers so they can be retried.

**Tech Stack:** Rust near-sdk 5.27 (`contract/`), Rust `wasm32-wasip2` OutLayer guest with `wasi-http-client` 0.2 and `serde_json` (`enclave/`), TypeScript on Node 26 built-ins with `node --test` (`relay/`).

**Spec:** `openspec/changes/screen-cross-chain-payer/specs/payment-clearing/spec.md`, `openspec/changes/screen-cross-chain-payer/specs/checkout-relay/spec.md`, `openspec/changes/screen-cross-chain-payer/design.md`.

## Global Constraints

- Payments without `ref` behave exactly as in `openspec/specs/payment-clearing/spec.md`.
- `ref` = 128-bit random, lowercase hex (32 chars). JSON key `"ref"`; Rust field `reference` with `#[serde(rename = "ref")]`.
- Gateway tokens: USDC `17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1`, nBTC `nbtc.bridge.near`, ZEC `zec.omft.near`.
- Supported origin chains (1Click `blockchain`): the keys of `EVM_RPC_URLS` (default `base`, `eth`, `arb`), plus `btc` and `zec`. Relay env `EVM_CHAINS` must list the same EVM keys.
- OFAC lists: `https://raw.githubusercontent.com/0xB10C/ofac-sanctioned-digital-currency-addresses/lists/sanctioned_addresses_XBT.txt` and `…_ZEC.txt`; a listed address scores 100, any other 0.
- `ONECLICK_API_KEY` is optional everywhere: send `X-API-Key` only when it is set.
- Relay: Node built-ins only, no npm dependencies. Enclave: HTTP only through `wasi-http-client`; every failed lookup returns `false`.
- Contract release build: `cd contract && cargo build --target wasm32-unknown-unknown --release`.
- Fresh deployment only: `Payment` and `Status` layouts change.
- Commits: short conventional style (`feat(contract): …`), one per task.

## Review Focus

- `screen_intents` sent before 1Click shows `SUCCESS`: must refund, never settle. Test `binding_rejects_processing` (4.1).
- Several origin deposits, one from a flagged sender: must refund. Test `any_flagged_sender_fails` (4.3).
- BTC coinbase input or ZEC deposit with no transparent inputs: must refund, not pass with zero senders. Tests `btc_coinbase_has_no_sender` and `zec_shielded_has_no_sender` (4.2), plus `empty_senders_fail` (4.3).
- Refund to a `refund_to` account without storage on `zec.omft.near`: must become `RefundFailed`, not `Refunded`. Test `failed_refund_marks_refund_failed` (3.2).
- A `ref` payment whose screening started but whose callback never returned: `reclaim` after 15 min must refund. Test `reclaim_after_screening_started` (3.1, done).

---

## 1. Live 1Click and chain-API fixtures

- [x] 1.1 Record a live anonymous 1Click `/v0/status` response as `enclave/tests/fixtures/oneclick-status-pending.json` (Base USDC → NEAR USDC quote with `customRecipientMsg`) and verify `jq -e '.quoteResponse.quoteRequest.customRecipientMsg and .quoteResponse.quoteRequest.recipient and .quoteResponse.quote.amountOut' enclave/tests/fixtures/oneclick-status-pending.json` exits 0
- [x] 1.2 Record chain-API fixtures and confirm a ZEC-origin quote; verify that all four files below exist and that `jq -e` passes for each check listed
  1. `enclave/tests/fixtures/evm-tx.json`: the `eth_getTransactionByHash` JSON-RPC response for any public Base USDC transfer. Check `.result.from`.
  2. `enclave/tests/fixtures/btc-tx.json`: mempool.space `GET /api/tx/{txid}` for a public non-coinbase tx with at least 2 inputs. Check `.vin[0].prevout.scriptpubkey_address`.
  3. `enclave/tests/fixtures/zec-tx.json`: a Zcash explorer response for a public transparent tx. Try the Blockchair `GET https://api.blockchair.com/zcash/dashboards/transaction/{hash}` API first. Record the chosen API URL in `design.md` decision 7 and check the input-address path.
  4. `enclave/tests/fixtures/oneclick-tokens.json`: a trimmed `/v0/tokens` with the Base USDC, NEAR USDC, `nbtc.bridge.near`, `1cs_v1:near:nep141:zec.omft.near`, `nep141:btc.omft.near`, `nep141:zec.omft.near` and one Solana entry. Copy it to `relay/src/fixtures/oneclick-tokens.json`.
  5. Run a dry quote `nep141:zec.omft.near` → `1cs_v1:near:nep141:zec.omft.near` with recipient `intents.near` and a non-sanctioned `t1…` refund address from the explorer. It must return a `quote`. If 1Click rejects it, stop and revisit design decision 5.

## 2. Contract: ref payments open without screening

- [x] 2.1 Accept `ref` payments in `ft_on_transfer` without screening and without panicking, and verify `cd contract && cargo test` passes `ref_payment_opens_pending_without_fuel`, `identity_gated_ref_payment_refunds`, `duplicate_ref_refunds`, `payment_without_ref_unchanged` (`identity_gated_ref_payment_refunds` removed later by `remove-kyc`)
- [x] 2.2 Add view `get_payment_by_ref(reference: String) -> Option<(PaymentId, Payment)>` to the `Gateflow` trait and verify `cargo test` passes `payment_lookup_by_ref`

## 3. Contract: deferred screening and transfer failures

- [x] 3.1 Add `screen_intents(payment: PaymentId, deposit_address: String) -> Promise` and verify `cargo test` passes `screen_intents_draws_fuel_and_stores_address`, `screen_intents_twice_fails`, `screen_intents_without_ref_fails`, `screen_intents_without_fuel_fails`, `reclaim_after_screening_started`, and the release build succeeds
- [x] 3.2 Catch failed settle/refund transfers and add `retry`; verify `cargo test` passes the five tests below and the release build succeeds

  **Files:** modify `contract/src/interface.rs` (`Status`, trait) and `contract/src/lib.rs` (`close`, new methods, tests module).
  **Interfaces:**
  - Produces `Status::SettleFailed` and `Status::RefundFailed` (appended after `Refunded`).
  - Produces `#[private] fn on_closed(&mut self, payment: PaymentId)`.
  - Produces `fn retry(&mut self, payment: PaymentId) -> Promise`.
  - Consumes `close(id, approved) -> Promise`, which now returns `ft_transfer(...).then(callback("on_closed", {"payment": id}, CLOSED_CALLBACK_GAS))`.
  - New const `CLOSED_CALLBACK_GAS = 10 Tgas`. Raise `SCREENED_CALLBACK_GAS` to 40 Tgas so `on_screened` can schedule transfer + callback.

  1. Write failing tests. Use `testing_env!` with `promise_results = vec![PromiseResult::Failed]` (or `Successful(vec![])`) before calling `on_closed`.
     - `failed_refund_marks_refund_failed`: ref payment, `close(0, false)`, then `on_closed(0)` with Failed → status `RefundFailed`.
     - `failed_settle_marks_settle_failed`: `close(0, true)`, then `on_closed(0)` with Failed → `SettleFailed`.
     - `successful_transfer_keeps_status`: `close(0, false)`, then `on_closed(0)` with Successful → `Refunded`.
     - `retry_resends_failed_refund`: after `RefundFailed`, `retry(0)` → status `Refunded` (until its own `on_closed`).
     - `retry_on_settled_fails`: `#[should_panic(expected = "payment has no failed transfer")]`.
  2. Run `cargo test`. Expected: compile errors for the missing `SettleFailed`, `on_closed` and `retry`.
  3. Implement. `on_closed` reads the transfer result with `env::promise_result_checked(0, 0)`. On error it flips `Settled` to `SettleFailed` and `Refunded` to `RefundFailed`, and logs `TRANSFER_FAILED payment={id}`. `retry` requires a failed status, flips it back, and returns the same `ft_transfer` + `on_closed` chain as `close`, to `payout_to` or `refund_to`.
  4. Run `cargo test`. Expected: all tests pass (15), no warnings. Then run `cargo build --target wasm32-unknown-unknown --release`.
  5. Commit `feat(contract): retry failed payout transfers`.

## 4. Enclave: binding, origin senders, screening

- [x] 4.1 Add the 1Click binding and chain lookup in new `enclave/src/oneclick.rs`; verify `cd enclave && cargo test` passes the seven tests below

  **Interfaces (produces):**
  - `pub fn binding(status: &Value, contract: &str, gateway: u64, reference: &str, amount: &str) -> bool`
  - `pub fn origin_chain(tokens: &Value, asset_id: &str) -> Option<String>`

  1. First confirm the host test build links: `cd enclave && cargo test` must report `running 0 tests`. If `wasi-http-client` breaks host linking, use `CARGO_TARGET_WASM32_WASIP2_RUNNER=wasmtime cargo test --target wasm32-wasip2` from now on and add that command to `GOAL.md` → Build.
  2. Write the failing tests in `#[cfg(test)] mod tests` of `oneclick.rs`. Load `tests/fixtures/oneclick-status-pending.json`, set `status = "SUCCESS"`, and edit one field per test:
     - `binding_accepts_matching`: `binding(&s, "intents.near", 0, "c20dd8cf397e7ad02972098f434f57fa", "1000000")` is true.
     - `binding_rejects_other_ref`: ref `"00"` → false.
     - `binding_rejects_other_recipient`: contract `"gateflow.near"` → false.
     - `binding_rejects_processing`: status `PROCESSING` → false.
     - `binding_rejects_amount_mismatch`: amount `"999999"` → false.
     - `origin_chain_base`: `origin_chain(&tokens, "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near") == Some("base")`.
     - `origin_chain_unknown`: `"nep141:nope.near"` → `None`.
  3. Run `cargo test`. Expected: FAIL (module missing).
  4. Implement. `binding` parses `quoteResponse.quoteRequest.customRecipientMsg` as JSON and compares `gateway` (number) and `ref`. `origin_chain` scans the array for an `assetId` match and returns its `blockchain`.
  5. Run `cargo test`. Expected: 7 passed.
  6. Commit `feat(enclave): verify 1Click quote binding`.
- [x] 4.2 Add sender resolvers in new `enclave/src/origin.rs`; verify `cargo test` passes the seven tests below

  **Interfaces (produces):**
  - `pub fn evm_sender(response: &Value) -> Option<String>`: `result.from`, lowercased.
  - `pub fn btc_senders(tx: &Value) -> Option<Vec<String>>`: every `vin[].prevout.scriptpubkey_address`. `None` if any input is a coinbase or lacks an address.
  - `pub fn zec_senders(tx: &Value) -> Option<Vec<String>>`: `recipient` of each entry in `data.<the only key>.inputs`. `None` if there are none.

  1. Write the failing tests from the 1.2 fixtures:
     - `evm_sender_from_fixture`: equals the fixture's `.result.from`, lowercased.
     - `evm_missing_result`: `json!({"result": null})` → `None`.
     - `btc_senders_from_fixture`: count equals the fixture's `vin` length.
     - `btc_coinbase_has_no_sender`: set `vin[0].is_coinbase = true` and `prevout = null` → `None`.
     - `zec_senders_from_fixture`: non-empty, every entry starts with `t`.
     - `zec_shielded_has_no_sender`: empty the input array → `None`.
     - `zec_missing_tx`: `json!({})` → `None`.
  2. Run `cargo test`. Expected: FAIL. 3. Implement. 4. Run: 7 passed. 5. Commit `feat(enclave): resolve origin senders per chain`.
- [x] 4.3 Add the screening rule and OFAC scoring to `origin.rs`; verify `cargo test` passes the five tests below

  **Interfaces (produces):**
  - `pub fn all_pass(senders: &[String], score: impl Fn(&str) -> Option<u8>, max_risk: u8) -> bool`: false for an empty slice or for any `None` or `> max_risk`.
  - `pub fn ofac_score(list: &str, address: &str) -> u8`: 100 if any trimmed line equals `address` (case-sensitive for base58 and bech32 as given), else 0.

  1. Write the failing tests:
     - `all_clean_pass`: two senders, score `Some(0)`, max 80 → true.
     - `any_flagged_sender_fails`: one sender scores `Some(100)` → false.
     - `empty_senders_fail`: `&[]` → false.
     - `unscored_sender_fails`: score `None` → false.
     - `ofac_listed`: `ofac_score("t1LHesgnkapziGQCJtrfZWYXhyjfTVo1dvh\nt1MMX...\n", "t1LHesgnkapziGQCJtrfZWYXhyjfTVo1dvh") == 100`, and an unlisted address gives 0.
  2. Run: FAIL. 3. Implement. 4. Run: 5 passed. 5. Commit `feat(enclave): screen senders against OFAC lists`.
- [x] 4.4 Wire `EnclaveRequest::ScreenIntents` and verify that `cargo build --target wasm32-wasip2 --release` succeeds and that `cargo test` still passes 19

  **Files:** `enclave/src/interface.rs` (variant `ScreenIntents { deposit_address: String, gateway: u64, #[serde(rename = "ref")] reference: String, amount: String, max_risk: u8 }`), `enclave/src/main.rs` (`mod oneclick; mod origin;`, the dispatch arm), `GOAL.md` ("Turn on the enclave" step 3: secrets `EVM_RPC_URLS`, optional `ONECLICK_API_KEY`).

  Flow in the `ScreenIntents` arm. Any `None` along the way gives `false`.
  1. Fetch `GET {ONECLICK_URL}/v0/status?depositAddress=` (with `X-API-Key` when set), then check `oneclick::binding(...)` against `GATEFLOW_CONTRACT`.
  2. Fetch `GET /v0/tokens`, then `origin_chain(quoteRequest.originAsset)`.
  3. Dispatch on the chain:
     - EVM key in `EVM_RPC_URLS`: POST `eth_getTransactionByHash` per `swapDetails.originChainTxHashes[].hash`, `evm_sender`, score with `GoPlus.risk_score`.
     - `btc`: `https://blockstream.info/api/tx/{hash}`, `btc_senders`, score with `ofac_score(XBT list)`.
     - `zec`: `https://api.blockchair.com/zcash/dashboards/transaction/{hash}`, `zec_senders`, `ofac_score(ZEC list)`.
  4. Return `all_pass(senders, score, max_risk)`. Fetch each list once per run.
  5. Commit `feat(enclave): screen 1Click origin senders`.

## 5. Relay: quotes, signer, screening trigger

- [x] 5.1 Build quotes for the gateway token with `ref`, the origin allow-list and required `refundOnNear`; verify that `node --test relay/src/checkout.test.ts` passes the six tests below and that a live anonymous `POST /checkout/quote` for 1 USDC from Base returns a 32-hex `ref`

  **Files:** create `relay/src/checkout.ts` and `relay/src/checkout.test.ts`; modify `relay/src/main.ts` and `relay/src/interfaces.ts` (`CheckoutRequest.refundOnNear: string`, `DepositInstruction.ref: string`).
  **Interfaces (produces):**
  - `destinationAsset(tokens: Token[], token: string): string | undefined`: the `blockchain === "near"` entry whose `assetId` is `nep141:${token}` or ends with `:nep141:${token}`, preferring the `1cs_v1:near:` form.
  - `originChain(tokens: Token[], assetId: string): string | undefined`
  - `screenable(chain: string, evmChains: string[]): boolean`: true for `evmChains`, `btc` and `zec`.

  1. Write the failing tests against `relay/src/fixtures/oneclick-tokens.json`:
     - `usdc_destination`: the NEAR USDC token → `nep141:17208628…`.
     - `nbtc_destination`: `nbtc.bridge.near` → `nep141:nbtc.bridge.near`.
     - `zec_destination`: `zec.omft.near` → `1cs_v1:near:nep141:zec.omft.near`.
     - `base_is_screenable`: `screenable(originChain(t, BASE_USDC)!, ["base","eth","arb"])` is true.
     - `btc_is_screenable`: true.
     - `solana_not_screenable`: false.
  2. Run `node --test relay/src/checkout.test.ts`. Expected: FAIL (module missing).
  3. Implement, then wire `intents.quote`:
     - Fetch `/v0/tokens` once per request.
     - Answer 422 "this origin chain can't be screened" when `screenable` is false.
     - Answer 502 "gateway token not deliverable by 1Click" when `destinationAsset` is undefined.
     - Generate `ref = randomBytes(16).toString("hex")`.
     - Set `customRecipientMsg = {gateway, ref, refund_to}` and include `ref` in the reply.
     - Make `refundOnNear` required (400 "not a NEAR account id").
     - Make `ONECLICK_JWT` an optional `X-API-Key` from `ONECLICK_API_KEY`.
  4. Run: 6 passed. Start the relay and `curl` a live quote. Expected: 200 with `ref`.
  5. Commit `feat(relay): quote gateway token with ref and origin allow-list`.
- [x] 5.2 Add a NEAR function-call signer in new `relay/src/near.ts`; verify that `node --test relay/src/near.test.ts` passes `base58_roundtrip` and `signature_verifies`, and that one live testnet `callFunction("gateflow-f604a6.testnet", "get_gateway", {gateway: 0}, 30n * 10n ** 12n)` returns a tx hash whose status is `SuccessValue`

  **Interfaces (produces):** `callFunction(contract: string, method: string, args: object, gas: bigint): Promise<string>` returns the tx hash. Env: `RELAY_ACCOUNT_ID`, `RELAY_PRIVATE_KEY` (`ed25519:<base58 64 bytes>`), `NEAR_RPC_URL`.
  - Base58 and borsh are hand-written.
  - Get the nonce and block hash from `view_access_key`.
  - Sign the sha256 of the borsh `Transaction` with `node:crypto` ed25519. Import the key by wrapping the 32-byte seed with PKCS#8 DER prefix `302e020100300506032b657004220420`.
  - Send with `send_tx`, `wait_until: "EXECUTED_OPTIMISTIC"`.
  - The relay account comes from `near account create-account sponsor-by-faucet-service` on testnet. The owner runs it.
  - Commit `feat(relay): sign NEAR function calls`.
- [x] 5.3 Add `POST /checkout/screen {depositAddress, ref}`; verify with a running relay that an unknown `ref` answers 404, that the pending deposit address from 1.1 answers 409 `{"error":"PENDING_DEPOSIT"}`, and that a non-hex `ref` answers 400
  - Flow:
    1. Validate `ref` against `/^[0-9a-f]{32}$/`.
    2. Call the view `get_payment_by_ref {"reference": ref}` (404 when null, before any 1Click call).
    3. `intents.status(depositAddress)` must be `SUCCESS`.
    4. `callFunction(GATEFLOW_CONTRACT, "screen_intents", {payment, deposit_address}, 300 Tgas)`.
    5. Return `{payment, txHash}`.
  - Add the route to the `GOAL.md` runbook table. Commit `feat(relay): trigger deferred screening`.

## 6. Mainnet integration

Moved to the `mainnet-launch` change and rewritten for the token allowlist model. Main specs already carried this change's requirements, so it was archived with `--skip-specs`.

## Workflow follow-up

- Run `/opsx:archive screen-cross-chain-payer` after review, so `payment-clearing` and `checkout-relay` main specs pick up the deltas.
