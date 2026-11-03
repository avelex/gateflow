# Screening Transparency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Only the `- [ ] X.Y` lines are tracked; bullets under them are the steps.

**Goal:** Show payers and merchants which OutLayer execution screened each payment, with which wasm hash, and with what outcome. All of it is read from the chain.

**Architecture:**
- The relay records one screening tx hash per payment, in SQLite.
- It parses that tx's `outlayer.near` NEP-297 events into evidence and caches the evidence once the payment closes.
- It serves the evidence, plus the live `get_project` active version, through the existing checkout and console endpoints.
- The web renders the evidence. There is no contract or enclave change.

**Tech Stack:** Node 22+ TypeScript relay (`node --test`, `node:sqlite`); React + Vite web (`vitest`).

**Spec:** `openspec/changes/screening-transparency/` (`proposal.md`, `design.md`, `specs/*/spec.md`)

## Global Constraints

- Accept OutLayer events only from receipts with `executor_id === cfg.outlayerContract` and `standard === "near-outlayer"`, `version === "1.0.0"`.
- Accept `payment_opened` only from receipts with `executor_id === cfg.gateflow` and `standard === "gateflow"`.
- Env: `OUTLAYER_CONTRACT` (default `outlayer.near`) and `OUTLAYER_PROJECT` (default `ops.gateflow.near/gateflow`).
- Evidence shape: `Screening = {txHash: string; requestId: number | null; project: string | null; wasmHash: string | null; wasmUrl: string | null; timeMs: number | null; costYocto: string | null; outcome: "pending" | "approved" | "rejected" | "failed" | "no_verdict"}`.
- Active version cache: 60 s. A failed read gives `activeVersion: null` and never fails the invoice.
- Explorer: `https://nearblocks.io/txns/<hash>`, or `https://testnet.nearblocks.io/txns/<hash>` when `VITE_NEAR_NETWORK=testnet`. OutLayer: `https://app.outlayer.ai/executions`.
- Payer copy: "Screened by OutLayer in an Intel TDX enclave (TEE)". Never show a wasm hash as the screening code for `failed` or `no_verdict`.
- Console: hashes, request id and cost appear only inside the expandable Details. Cost is formatted in NEAR.

## Review Focus

- **Spoofed event:** an `EVENT_JSON` `execution_completed` logged by a non-OutLayer receipt must be ignored. Test in 1.1.
- **Late verdict after `reclaim`:** a `true` verdict on a Refunded payment must give `no_verdict`, not `approved`. Test in 1.2.
- **Reported hash that opened a different payment:** answer 422, record nothing. Test in 3.2.
- **Tx not final yet when reported** (RPC `UNKNOWN_TRANSACTION`): answer 404 so the page retries, and do not store. Test in 3.2.
- **OutLayer `get_project` down:** the invoice still loads with `activeVersion: null`, and the pre-pay box claims no version. Tests in 3.3 and 5.2.

---

## 1. Evidence parser

- [x] 1.1 Parse OutLayer evidence from a tx status result; verify `cd relay && node --test src/screening.test.ts` passes
  - **Files:** create `relay/src/screening.ts`, `relay/src/screening.test.ts`, and `relay/src/fixtures/outlayer-tx-approved.json`. Build the fixture from the `result` of `EXPERIMENTAL_tx_status` for `4e9WUscwEZJ4V87JKR9VDHctY5otTxXCCte3nY3cYn1o`, sender `gateflow.near`, on `https://free.rpc.fastnear.com`.
  - **Produces:** `type Parsed = {requestId, project, wasmHash, wasmUrl, timeMs, costYocto, success: boolean | null, verdict: boolean | null}` and `parseEvidence(tx: any, outlayer: string): Parsed`. Take `requestId` and `project` from `execution_requested.data[0].request_data`, which is a JSON string: parse it. Take the remaining fields from `execution_completed.data[0]`. `verdict` is the JSON-decoded `SuccessValue` of the receipt that logged `execution_completed`. If the OutLayer receipt has a `Failure` status, `success` is false.
  - **Tests:**
    - `approved_fixture`: requestId 2792, wasmHash `11a4efa612d4c52ecad82827035968f34f7bc840d2b1fea28a70715f2ee6dabe`, timeMs 1410, costYocto `"1141000000000000000000"`, success true, verdict true.
    - `spoofed_executor_ignored`: rewrite the `execution_completed` receipt's `executor_id` to `evil.near`, and expect wasmHash and verdict null.
    - `other_standard_ignored`: same idea with `standard` `"fake"`.
    - `failed_completion`: set `success` false and `error_message` `"timeout"`, and expect success false.
    - `no_outlayer_receipts`: expect every field null.
  - **Commit:** `feat(relay): parse OutLayer screening evidence`
- [x] 1.2 Classify outcome and detect `payment_opened`; verify `node --test src/screening.test.ts` passes
  - **Produces:**
    - `outcome(status: string, p: Parsed): Screening["outcome"]`, following the rules in design decision 5.
    - `opensPayment(tx: any, gateflow: string, payment: number): boolean`.
  - **Tests:**
    - `pending`: `outcome("Pending", any)` returns `pending`.
    - `approved`: Settled with success and verdict true. Also check that `SettleFailed` with verdict true gives `approved`.
    - `rejected`: Refunded with verdict false.
    - `failed`: Refunded with success false.
    - `late_true_after_reclaim`: Refunded with success and verdict true gives `no_verdict`.
    - `reclaim_no_completion`: Refunded with all nulls gives `no_verdict`.
    - `opens_payment`: a fixture receipt logging `{"standard":"gateflow","event":"payment_opened","data":[{"payment":3,...}]}` from `gateflow.near` gives true for 3 and false for 4. The same log from another executor gives false.
  - **Commit:** `feat(relay): screening outcome rules`

## 2. Storage and RPC

- [x] 2.1 Add the `screenings` table and the tx lookup; verify `cd relay && npm test` passes
  - **Files:** `relay/src/db.ts`, `relay/src/near.ts`, `relay/src/testing.ts`, and their tests.
  - **DB:**
    - Add `CREATE TABLE IF NOT EXISTS screenings (payment INTEGER PRIMARY KEY, tx_hash TEXT NOT NULL, sender TEXT NOT NULL, evidence TEXT)`.
    - Add `recordScreening(payment: number, txHash: string, sender: string): void`, which uses `INSERT OR IGNORE`.
    - Add `screening(payment: number): {tx_hash, sender, evidence: string | null} | undefined`.
    - Add `storeEvidence(payment: number, evidence: Screening): void`.
  - **Near:** add `tx(hash: string, sender: string): Promise<any | undefined>` to the `Near` interface. It calls `EXPERIMENTAL_tx_status` with `wait_until: "FINAL"` and returns `undefined` on `UNKNOWN_TRANSACTION`. `fakeNear` gains `txTable: Record<string, any>`.
  - **Tests:**
    - `record_first_wins`: a second `recordScreening` for the same payment keeps the first hash.
    - `tx_unknown_is_undefined`: use a fake RPC error.
  - **Commit:** `feat(relay): screenings table and tx lookup`
- [x] 2.2 Resolve evidence per payment with caching; verify `node --test src/screening.test.ts` passes
  - **Produces:** `evidenceFor(deps: Deps, paymentId: number, status: string): Promise<Screening | null>`.
    - It returns null when there is no row.
    - When the row has stored evidence, it returns that evidence without an RPC call.
    - Otherwise it calls `deps.near.tx(row.tx_hash, row.sender)`, then `parseEvidence` and `outcome`. It stores the result when `status !== "Pending"`.
    - If the tx is undefined, it returns `{txHash, ...nulls, outcome: status === "Pending" ? "pending" : "no_verdict"}` and does not store it.
  - **Tests:**
    - `stored_no_rpc`: `txTable` is empty, yet stored evidence is returned.
    - `settled_stores_once`: a second call makes no `tx` call.
    - `pending_not_stored`.
    - `no_row_null`.
  - **Commit:** `feat(relay): cached screening evidence`

## 3. Checkout relay

- [x] 3.1 Record the cross-chain screening tx in `submitScreening`; verify `node --test src/checkout.test.ts src/watcher.test.ts` passes
  - **Change:** `relay/src/checkout.ts:144`. On success, call `deps.db.recordScreening(payment, r.hash, deps.cfg.accountId)`. The "screening already started" path records nothing.
  - **Tests:** `screen_records_tx` (the POST `/checkout/screen` path) and `watcher_records_tx`.
  - **Commit:** `feat(relay): record screen_intents tx`
- [x] 3.2 Add `POST /checkout/tx`; verify `node --test src/checkout.test.ts` passes
  - **Behavior:** take `{invoice, txHash}` and validate the hash against `/^[1-9A-HJ-NP-Za-km-z]{43,44}$/`. Otherwise answer 400.
    - The invoice has no payment: 404.
    - `near.tx(txHash, payment.payer)` is undefined: 404, because the page retries.
    - `!opensPayment(tx, cfg.gateflow, invoice.payment)`: 422.
    - Otherwise record `(payment, txHash, payer)` and answer `{payment}`.
  - **Tests:**
    - `tx_accepted`
    - `tx_other_payment_422`: nothing recorded.
    - `tx_not_final_404`: nothing recorded.
    - `tx_no_payment_404`
    - `tx_bad_hash_400`
    - `tx_second_report_keeps_first`
  - **Commit:** `feat(relay): direct-pay tx report`
- [x] 3.3 Add `enclave` and `screening` to `GET /checkout/invoice`; verify `node --test src/checkout.test.ts` passes
  - **Files:** `relay/src/types.ts`. `Config` gains `outlayerContract` and `outlayerProject` from `OUTLAYER_CONTRACT` and `OUTLAYER_PROJECT`, with the defaults above. Also `relay/src/screening.ts`.
  - **Produces:** `activeVersion(deps): Promise<string | null>`. It views `get_project({project_id})` and returns its `active_version`, cached 60 s against `deps.now()`. On error it returns null.
  - **Response:** `enclave: {project: cfg.outlayerProject, activeVersion}`. `screening` is `evidenceFor(...)` when there is a payment, and null otherwise.
  - **Tests:**
    - `enclave_included`
    - `active_version_cached`: two calls 5 s apart make one view, and a call after 61 s makes a second one.
    - `outlayer_down_null`: a view that throws gives `activeVersion` null and status 200.
    - `screened_invoice_evidence`
  - **Docs:** add `OUTLAYER_CONTRACT` and `OUTLAYER_PROJECT` to the relay env docs wherever `GATEFLOW_CONTRACT` is documented.
  - **Commit:** `feat(relay): enclave facts in checkout invoice`

## 4. Console relay

- [x] 4.1 Add `screening` to each row of `GET /console/payments`; verify `node --test src/console.test.ts` passes
  - **Change:** `relay/src/console.ts:331`. Map each payment through `evidenceFor(deps, id, status)`.
  - **Test:** `payments_carry_screening`. Payment 3 has stored evidence and payment 4 has no row, which gives null.
  - **Commit:** `feat(relay): screening evidence in console payments`

## 5. Payer checkout (web)

- [x] 5.1 Report the direct-pay hash; verify `cd web && npx vitest run src/checkout` passes
  - **Files:** `web/src/checkout/wallet.ts`, `NearPay.tsx`, `logic.ts`, `Checkout.tsx`, and `logic.test.ts`.
  - **Wallet:** `payDirect` returns `outcome.transaction.hash`. The hash is saved in sessionStorage under `gateflow:tx:<invoice>`.
  - **Produces:** `returnedHash(search: string): string | undefined`, which reads the first entry of `transactionHashes`.
  - **Checkout:** on each poll, while the hash is unsent, POST `/checkout/tx`. Retry on 404. Stop on 200 or 422.
  - **Tests:**
    - `returned_hash_from_redirect`: `?transactionHashes=8Kd,9Zz` gives `8Kd`.
    - `no_hash`: an empty search gives undefined.
  - **Commit:** `feat(web): report direct-pay tx`
- [x] 5.2 Add the "How screening works" box and the evidence row on the timeline; verify `npx vitest run src/checkout` passes and the page renders in `npm run dev`
  - **Files:** `logic.ts` (`CheckoutInvoice` gains `enclave` and `screening`), `Checkout.tsx`, `Timeline.tsx`.
  - **Produces:**
    - `explorerTx(hash: string, network: string): string`.
    - `screeningDetail(s: Screening | null, decided: boolean): {text: string; links: {label: string; href: string}[]}`.
  - **Pre-pay box:** a collapsible `<details>` under the `FLOW` list.
    - It lists the checks from the payer-checkout spec, with the TEE copy.
    - It shows the project and the short hash `activeVersion.slice(0, 8)`, labeled "current code" and linked to the FastFS URL when one is known.
    - It shows the source link only when `VITE_ENCLAVE_SOURCE_URL` is set.
  - **Tests:**
    - `detail_approved`: the text contains `request 2792`, `11a4efa6` and `1.4 s`, with two links.
    - `detail_failed`: contains "returned no verdict" and does not contain `11a4efa6`.
    - `detail_no_verdict`: contains "within 15 minutes".
    - `detail_null_decided`: contains "record unavailable" and has the OutLayer link.
    - `explorer_testnet`: the URL has the `testnet.nearblocks.io` prefix.
  - **Commit:** `feat(web): screening evidence on checkout`

## 6. Merchant console (web)

- [x] 6.1 Add the Screening block in the invoice Details; verify `npx vitest run src/console` passes
  - **Files:** `web/src/console/logic.ts` (`Payment` gains `screening: Screening | null`), `cards.tsx` (`InvoiceCard` `<details>`), `logic.test.ts`.
  - **Produces:** `screeningFields(p: Payment): {label: string; value: string; href?: string}[]`.
    - The fields are Flow (Direct or Cross-chain, from `reference`), Risk limit (`max_risk`), Deposit address (cross-chain only) and Project.
    - With evidence there are also Outcome, Request, Wasm, Run time, Cost (yocto formatted as NEAR) and the two links.
  - **Tests:**
    - `fields_direct_approved`: includes `Risk limit` and `0.001141 NEAR`.
    - `fields_no_verdict`: has no `Wasm` field and includes "No verdict within 15 minutes".
    - `fields_unavailable`: includes "record unavailable".
    - `fields_cross_chain`: includes `Deposit address`.
  - **Commit:** `feat(web): screening details in console`

## 7. Spike and integration

- [x] 7.1 Spike: OutLayer per-execution attestation link. Verify a note in `enclave/README.md` that records either the URL pattern (and update `explorer` links in 5.2 and 6.1 to use it) or "none found" with the date
- [x] 7.2 End-to-end check against mainnet data. Run the relay locally with `NEAR_RPC_URL=https://free.rpc.fastnear.com`, and verify that `GET /checkout/invoice` for a real screened invoice returns `enclave.activeVersion` `11a4ef…` and `screening.outcome` matching its status. Then verify `cd relay && npm test` and `cd web && npm test && npm run build` all pass.

## Workflow follow-up

- Archive the change after review with `/opsx:archive screening-transparency`.
