# Screen Solana Payer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Screen Solana-origin 1Click payments (every signer against OFAC SOL), and open Solana quotes in the relay.

**Architecture:** Add a `sol` branch in the enclave's `screen_intents` next to `btc` and `zec`. Mirror the same lookup in the relay's `origin.ts` for console display, and let `screenable()` accept `sol`. The contract does not change: OutLayer runs the project's active version.

**Tech Stack:** Rust (`wasm32-wasip2`, serde_json) enclave; TypeScript relay on Node built-ins (`node:test`); React web.

**Spec:** `openspec/changes/screen-solana-payer/{proposal.md,design.md,specs/}`

## Global Constraints

- Solana RPC: `https://solana-rpc.publicnode.com`, fixed at build in both `enclave/src/origin.rs` and `relay/src/origin.ts`.
- RPC body: `{"jsonrpc":"2.0","id":1,"method":"getTransaction","params":[<sig>,{"encoding":"jsonParsed","maxSupportedTransactionVersion":0,"commitment":"confirmed"}]}`.
- Senders: `result.transaction.message.accountKeys[*].pubkey` where `signer == true`, in key order, case kept (base58, never lowercased).
- OFAC list: `https://raw.githubusercontent.com/0xB10C/ofac-sanctioned-digital-currency-addresses/lists/sanctioned_addresses_SOL.txt`. Listed = 100, else 0.
- 1Click chain id: `sol`. Display name: `Solana`.
- Fail closed: null `result`, an RPC `error`, no signers, or a failed fetch gives `false`.
- The relay stays on Node built-ins; the enclave adds no crates.
- Commits: conventional style, short.

## Review Focus

- An RPC error object (`{"error":{...}}`, no `result`) must give `false` / undefined, not a panic. Covered in 1.1 and 2.1.
- A v0 transaction with lookup-table keys (`source: "lookupTable"`, `signer: false`) must not add those keys as senders. Covered in 1.1 and 2.1.
- Base58 case must survive: the relay must not lowercase Solana senders the way it does for EVM. Covered in 2.1.
- Several `originChainTxHashes` on Solana: one sanctioned signer in any tx refunds. Covered in 1.2.
- A Solana quote must actually be quotable end to end (quote returns a deposit address), not just `screenable()`. Covered in 2.2.

---

## 1. Enclave: Solana senders and screening

**Files:** Modify `enclave/src/origin.rs`, `enclave/src/ofac.rs`, `enclave/src/flows.rs`. Create `enclave/tests/fixtures/sol-tx.json` (v0 tx, signers `Fee1…` fee payer and `Own1…` owner, plus one `lookupTable` key with `signer: false`), `enclave/tests/fixtures/ofac-sol.txt` (the 4 live addresses).

**Interfaces (produces):**
- `pub const SOL_RPC: &str = "https://solana-rpc.publicnode.com";` in `origin.rs`
- `pub fn sol_tx_body(sig: &str) -> String` in `origin.rs`
- `pub fn sol_senders(body: &str) -> Option<Vec<String>>` in `origin.rs`: `None` when `result` is null or missing, or when there is no signer
- `pub const SOL_LIST: &str` in `ofac.rs`

- [x] 1.1 Write failing tests in `origin.rs`: `sol_signers_in_order` (fixture gives exactly `["Fee1…", "Own1…"]`, with the lookup-table key absent), `sol_null_result_none` (`{"jsonrpc":"2.0","id":1,"result":null}` gives `None`), `sol_rpc_error_none` (`{"jsonrpc":"2.0","id":1,"error":{"code":-32602}}` gives `None`), `sol_tx_body_shape` (parsed body equals the Global Constraints body). Run `cd enclave && cargo test sol_`; expect a compile failure.
- [x] 1.2 Write failing tests in `flows.rs` with the `Net` routes, keyed `"POST https://solana-rpc.publicnode.com <sig>"`, using `SOL_USDC = "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near"`:
  - `clean_sol_payer`: the result is `true`.
  - `sanctioned_sol_signer`: `Own1…` is replaced by a listed address; the result is `false`.
  - `sol_tx_not_found`: a null result gives `false`.
  - `sol_rpc_down`: no route gives `false`.
  - `sol_two_txs_one_flagged`: two hashes, the second has a listed signer; the result is `false`.
- [x] 1.3 Implement `SOL_RPC`, `sol_tx_body` and `sol_senders` in `origin.rs`, `SOL_LIST` in `ofac.rs`, and an `else if chain == "sol"` branch in `screen_intents`. The branch follows the `btc` pattern: fetch `SOL_LIST` once, then POST each hash, call `sol_senders`, and map each sender through `ofac_score`.
- [x] 1.4 Run `cd enclave && cargo test`; expect all tests to pass. Run `GATEFLOW_CONTRACT=gateflow.near cargo build --target wasm32-wasip2 --release`; expect it to build.
- [x] 1.5 Commit: `feat(enclave): screen solana signers against OFAC`.

## 2. Relay: quote Solana and resolve its senders

**Files:** Modify `relay/src/checkout.ts:54`, `relay/src/origin.ts`, `relay/src/checkout.test.ts`, `relay/src/origin.test.ts`. Create `relay/src/fixtures/sol-tx.json` (same shape as the enclave fixture).

**Interfaces (consumes):** the RPC URL, body and signer rule from Global Constraints. They must match Task 1 exactly.

- [x] 2.1 In `origin.test.ts`, replace `unknown_chain_none` with these tests:
  - `sol_request`: `originRequest("sol","ab")` has url `https://solana-rpc.publicnode.com`, method `POST`, and the Global Constraints body.
  - `sol_signers`: `parseSenders("sol", sig, fx("sol-tx.json"))` deep-equals `["Fee1…","Own1…"]`, case kept.
  - `sol_null_and_error_none`: both give `undefined`.
  - `unknown_chain_none`: now uses `"tron"`.
- [x] 2.2 In `checkout.test.ts`:
  - Rename `solana_not_screenable` to `solana_screenable`, asserting `true`.
  - Replace `quote_solana_422` with `quote_tron_422`. Add a `{blockchain:"tron", symbol:"USDT"}` asset to its token list; it answers 422.
  - Add `quote_solana_ok`: `SOL_USDC` on an Open USDC invoice gives 200 with `depositAddress`, `amountIn` and `ref`.
  - In `assets_without_invoice_lists_all`, assert that a `sol` asset IS present.
  - In `assets_usdc_same_asset`, compare sorted: `["arb USDC","base USDC","eth USDC","sol USDC"]`.
  - Run `cd relay && npm test`; expect these tests to fail.
- [x] 2.3 Implement `screenable` to accept `chain === "sol"`. Add `sol` to `originRequest` and `parseSenders` (no lowercasing for `sol`). Add `sol: "Solana"` to `CHAIN_NAMES` in `origin.ts`.
- [x] 2.4 Run `cd relay && npm test`; expect all tests to pass.
- [x] 2.5 Commit: `feat(relay): quote and resolve solana origins`.

## 3. Web: Solana refund address and origins

**Files:** Modify `web/src/checkout/CrossChainPay.tsx:144`.

- [x] 3.1 Make the refund placeholder `"7xKX…"` when `asset.chain === "sol"`, keeping the btc, zec and `0x…` cases.
- [x] 3.2 Check by reading `web/src/console/Settings.tsx:74` and `web/src/assets.ts` that Settings derives origins from `/checkout/assets` and names `sol` "Solana" with its icon. No code change is expected. Also confirm that the landing already lists NEAR, Ethereum, Solana, Bitcoin, Zcash (`web/src/landing/Landing.tsx:11`), matching the `landing-page` delta.
- [x] 3.3 Run `cd web && npx tsc --noEmit && npx vitest run src/checkout src/console src/landing`; expect them to pass.
- [x] 3.4 Commit: `feat(web): solana refund placeholder`.

## 4. Mainnet rollout and check

- [x] 4.1 Confirm that live `GET https://1click.chaindefuser.com/v0/tokens` lists USDC with `blockchain: "sol"` and `coingeckoId: "usd-coin"`. If the id differs, stop and update the specs and Tasks 1–2.
- [ ] 4.2 As `ops.gateflow.near`, run `outlayer upload target/wasm32-wasip2/release/gateflow-enclave.wasm`, then `outlayer deploy gateflow <url>`. Record the new wasm hash and the date in `enclave/README.md` under Mainnet.
- [ ] 4.3 Deploy the relay to Fly.io (`relay/README.md` § Deploy). Then `GET https://gateflow.fly.dev/checkout/assets` lists a `sol` USDC asset.
- [ ] 4.4 Pay a 0.01 USDC invoice from Solana. Expect the payment `Settled`, the attestation showing the new wasm hash, and the console payer reading "<addr> on Solana". Record the invoice id, Solana signature and attestation link in `relay/README.md`.
- [ ] 4.5 Commit: `docs: record solana mainnet check`.

## Workflow follow-up

- Archive with `/opsx:archive screen-solana-payer` after 4.4 passes. The `readme-for-judges` change cites the 4.4 payment.
