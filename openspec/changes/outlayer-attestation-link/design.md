# Design

## Context

- **Where evidence comes from.** `relay/src/screening.ts` `evidenceFor` builds evidence from the screening tx's `outlayer.near` events. It stores the evidence in `screenings.evidence` once the payment is closed. The evidence has `requestId`, but no OutLayer `job_id`.
- **The OutLayer API we rely on.** This was checked against mainnet on 2026-11-03 and is recorded in `enclave/README.md` under "Execution attestations".
  - `GET https://api.outlayer.ai/public/jobs?user_account_id=<signer>&project=<project>&limit=<n>&offset=<k>` returns jobs newest first. Each job has `job_id`, `request_id`, `transaction_hash`, `status` and `success`. Unknown query params are ignored, so there is no server-side filter by tx.
  - `user_account_id` is the **tx signer**, not the contract that called OutLayer. For example, `screen_intents` jobs are listed under `relay.gateflow.near`. `screenings.sender` already stores that signer for both flows.
  - The attestation page is `https://app.outlayer.ai/attestation/<job_id>?network=mainnet`.
  - Testnet uses `https://testnet-api.outlayer.ai`.
- **How the relay already talks to outside services.** It injects them through `Deps` (`oneclick: OneClick`) and replaces them with fakes in `testing.ts`.

## Goals / Non-Goals

**Goals:**
- Link each screening straight to its attestation when OutLayer knows the job.
- Never fail or slow an invoice read because of OutLayer.

**Non-Goals:**
- No verification of the attestation (TDX quote, measurements) in Gateflow.
- No background backfill job. Old evidence gains its `jobId` the next time it is read.

## Decisions

1. **An injected `OutLayerApi` client.** `Deps` gains `outlayer: OutLayerApi`, with one method: `jobs(q: {user: string; project: string; limit: number; offset: number}): Promise<any[]>`.
   - `main.ts` builds it from `cfg.outlayerApi`, with a 5 s `AbortSignal.timeout`.
   - It mirrors `oneClick()`, so tests use a fake instead of the network.
   - Alternative: call `fetch` inside `screening.ts`. Rejected, because it is not testable with the existing pattern.

2. **Match on both tx hash and request id.** `findJob` pages through `limit: 50` jobs, up to 4 pages. It returns the `job_id` of the first job where `transaction_hash === txHash && request_id === requestId`, and stops early on a short page.
   - The double match keeps a different job that happens to share the tx from being linked as the screening's job.
   - `ponytail:` 200 jobs per signer is the ceiling. That is enough because the lookup runs within minutes of the screening. Raise the page count, or ask OutLayer for a tx filter, if the relay screens more than about 200 payments between a payment closing and its next read.

3. **Throttled retry, kept in memory.** A `WeakMap<Deps, Map<payment, lastTryMs>>` allows one lookup per payment per 60 s. This follows the same pattern as the `activeVersion` cache. A relay restart forgets it, which only means one early retry.

4. **Where the lookup runs.** At the end of `evidenceFor`:
   - If `requestId !== null` and `jobId` is null or missing, and the throttle allows, it calls `findJob`.
   - When a job is found and the payment is closed, it writes the updated evidence back with `storeEvidence`.
   - Any lookup error is treated the same as "not found".
   - The `Screening` type gains `jobId: number | null`. Stored rows without the field read as null.

5. **Web links.** `attestationUrl(jobId, network)` returns `https://app.outlayer.ai/attestation/${jobId}?network=${network}`.
   - In `screeningDetail`, the "OutLayer executions" link becomes "TEE attestation" when `jobId` is set.
   - In `screeningFields`, the Request field links to the attestation instead of the executions list.
   - `failed` and `no_verdict` keep their current links, so they still show no screening code.

6. **Config.** `OUTLAYER_API` defaults to `https://api.outlayer.ai`. The README env table gains this row.

## Risks / Trade-offs

- [OutLayer changes or removes this undocumented API] → `jobs()` throws or returns odd data, `findJob` returns null, and the UI falls back to the executions link. A fixture test locks the current response shape.
- [Requests to OutLayer from polling pages] → At most one per payment per minute, and only while `jobId` is null. Once a job is found it is stored for closed payments.
- [Signer mismatch for direct payments made through a contract wallet] → The lookup misses and the executions link stays. This is the same limit as `POST /checkout/tx`.
- [The relay sends the tx signer and hash to OutLayer] → Both are already public on-chain.

## Migration Plan

- **Rollout.** Deploy the relay and the web app. Existing stored evidence, such as payment 0, gets its `jobId` on the next read.
- **Rollback.** Revert. A stored `jobId` field is ignored by the old code.
