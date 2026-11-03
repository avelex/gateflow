# Design

## Context

- **Where screening runs.** The contract calls `outlayer.near.request_execution` in one of two places. For a direct payment it is the payer's `ft_transfer_call` tx (via `ft_on_transfer`). For a cross-chain payment it is the relay's `screen_intents` tx. The verdict comes back to `on_screened` as a bare `true`/`false`.
- **The contract stores no screening record.** It keeps no tx hash and no OutLayer request id. `enclave` is private, and `version_key` is `null`, meaning the active version runs.
- **OutLayer writes the evidence into the tx itself.** This was checked on mainnet tx `4e9WUscwEZJ4V87JKR9VDHctY5otTxXCCte3nY3cYn1o`. The `outlayer.near` receipts log NEP-297 events with `"standard":"near-outlayer"`:
  - `execution_requested`: `data[0].request_data` is a JSON string carrying `request_id`, `project_id` and `code_source.WasmUrl.hash`.
  - `execution_completed`: `code_source.WasmUrl.hash`, `resources_used.time_ms`, `success`, `error_message`, `payment_charged`.
  - The receipt that logs `execution_completed` returns the verdict as `SuccessValue` (`true`).
- **The active version is readable.** `outlayer.near.get_project({project_id})` returns `active_version`.
- **The relay already has the pieces.** It has an RPC client (`relay/src/near.ts`) with `view` and `send` but no tx lookup. It has SQLite (`relay/src/db.ts`). `submitScreening` already gets the `screen_intents` hash and drops it.
- **The browser already sees the direct-pay hash.** A popup wallet returns `outcome.transaction.hash` (`web/src/checkout/wallet.ts`). A redirect wallet returns to the page with `?transactionHashes=`.

## Goals / Non-Goals

**Goals:**
- Every displayed screening fact can be traced to a NEAR tx or to an `outlayer.near` view.
- Nothing is claimed for a payment that closed without a completed execution.

**Non-Goals:**
- No change to the contract or the enclave.
- No indexer.
- No TDX quote verification in Gateflow's UI.
- No reason codes.

## Decisions

1. **Evidence comes from tx logs, not from OutLayer's dashboard or API.** The logs are on-chain, already final, and readable with plain RPC (`EXPERIMENTAL_tx_status`, `wait_until: FINAL`). The OutLayer coordinator API has no documented attestation endpoint.
   - Alternative: scrape `app.outlayer.ai`. Rejected: it is undocumented and renders client-side.

2. **Trust only `outlayer.near` receipts and the right standard.** The parser accepts `execution_*` events only from receipts with `executor_id === OUTLAYER_CONTRACT` and `standard === "near-outlayer"`. It accepts `payment_opened` only from receipts with `executor_id === GATEFLOW_CONTRACT` and `standard === "gateflow"`. Any contract can log an `EVENT_JSON:` line, but no contract can log from another account's receipt.

3. **Direct-pay hash is reported by the browser and verified against the chain.**
   - `POST /checkout/tx` looks up the tx with `sender_account_id = payment.payer`, the payer of the invoice's linked payment. It accepts the hash only if the tx holds `payment_opened{payment}` from the Gateflow contract.
   - The browser sends the hash right after the wallet returns, and again on each 5 s poll while the relay answers 404 (the payment is not linked yet, or the tx is not final yet).
   - A payer who pays through a contract or multisig has a different signer, so the lookup fails with 422. That payment simply shows no evidence.
   - Alternative: an indexer such as NearBlocks or the FastNear tx API. Deferred, because it adds a third-party dependency and an API key.

4. **One table for both flows.**
   - Schema: `screenings(payment INTEGER PRIMARY KEY, tx_hash TEXT NOT NULL, sender TEXT NOT NULL, evidence TEXT)`.
   - Rows are written with `INSERT OR IGNORE`, so the first hash wins.
   - `submitScreening` inserts `(payment, hash, relay account)`. `POST /checkout/tx` inserts `(payment, hash, payer)`.
   - `evidence` stays NULL until the payment is no longer Pending. Then the parsed JSON is written once and served from storage.
   - Alternative: a `tx_hash` column on `quotes`. Rejected: it covers only cross-chain.

5. **Outcome rules.** These are pure functions of `(payment status, parsed tx)`:
   - `pending`: the payment is Pending.
   - `approved`: `execution_completed.success`, the verdict is `true`, and the status is Settled or SettleFailed.
   - `rejected`: `success`, the verdict is `false`, and the status is Refunded or RefundFailed.
   - `failed`: the `outlayer.near` receipt failed, or `execution_completed.success` is false.
   - `no_verdict`: anything else. This covers `reclaim` before completion, and a late verdict that does not match the final status.

6. **Evidence shape.** The same shape goes to checkout and console: `{txHash, requestId, project, wasmHash, timeMs, costYocto, outcome}`. Fields the tx lacks are null. Cost is a yoctoNEAR string; the console formats it as NEAR inside Details only, which the "No chain vocabulary by default" requirement allows.

7. **Active version cache.**
   - The cache is a module-level `{value, at}` that is re-read after 60 s.
   - If the read fails, the relay returns `activeVersion: null` and does not fail the invoice.
   - The values come from new env vars `OUTLAYER_CONTRACT` (default `outlayer.near`) and `OUTLAYER_PROJECT` (default `ops.gateflow.near/gateflow`). These are relay env, not a contract view, so no redeploy is needed.

8. **Links.**
   - The explorer tx link is `https://nearblocks.io/txns/<hash>`, with the `testnet.` prefix when `VITE_NEAR_NETWORK=testnet`.
   - The OutLayer link is `https://app.outlayer.ai/executions`, shown next to the request id, until the spike finds a per-execution URL.
   - The wasm hash links to its FastFS URL from the event. Anyone can download it there and run `sha256` on it.
   - A source-code link is shown only when `VITE_ENCLAVE_SOURCE_URL` is set. The repo is not necessarily public.

## Risks / Trade-offs

- [The payer closes the tab before the hash is reported] → The evidence is null and the UI says "record unavailable". An indexer fallback is a later change.
- [OutLayer renames the event fields or bumps the event version] → The parser accepts only `version` `1.0.0`. Unknown shapes produce null fields, not errors. A fixture test locks the mainnet shape.
- [`EXPERIMENTAL_tx_status` is unavailable on the configured RPC] → It is supported by the FastNear and NEAR RPCs. On error, the relay treats the evidence as not available yet and retries on the next request.
- [Stored evidence is wrong because of a parser bug] → Evidence is derived data. Clearing the `evidence` column forces a re-parse.
- [The pre-pay hash is the *current* version, which may differ by the time the payment is screened] → The copy says "current code". The per-payment hash comes only from that payment's tx.

## Migration Plan

- **Rollout.** `CREATE TABLE IF NOT EXISTS` adds the table on relay start.
- **Payments screened before the deploy.** They have no row and show "record unavailable".
- **Rollback.** Revert the relay and web. The leftover table is harmless.

## Open Questions

- Does OutLayer have a per-execution attestation URL or API? This is the spike task. Only the link target changes.
- Is the repo public, so that `VITE_ENCLAVE_SOURCE_URL` can be set on mainnet?
