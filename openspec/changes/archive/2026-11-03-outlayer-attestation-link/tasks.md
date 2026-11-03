# OutLayer Attestation Link Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Only the `- [ ] X.Y` lines are tracked; bullets under them are the steps.

**Goal:** Resolve each screening's OutLayer `job_id` and link checkout and console straight to its TEE attestation page.

**Architecture:**
- An injected `OutLayerApi` client lists the jobs of the tx signer.
- `findJob` matches the job on tx hash and request id.
- `evidenceFor` fills in `jobId`, retries a missing one at most once a minute, and stores it once found.
- The web app turns `jobId` into the attestation URL.

**Tech Stack:** Node TypeScript relay (`node --test`); React + Vite web (`vitest`).

**Spec:** `openspec/changes/outlayer-attestation-link/` (`proposal.md`, `design.md`, `specs/*/spec.md`)

## Global Constraints

- Jobs API: `GET <OUTLAYER_API>/public/jobs?user_account_id=<signer>&project=<project>&limit=50&offset=<k>`. Read at most 4 pages, with a 5 s timeout per call.
- Match only when `transaction_hash === txHash && request_id === requestId`.
- Retry throttle: one lookup per payment per 60 s.
- Env: `OUTLAYER_API`, default `https://api.outlayer.ai`.
- Attestation URL: `https://app.outlayer.ai/attestation/<jobId>?network=<VITE_NEAR_NETWORK>`.
- The `Screening` type gains `jobId: number | null`. A stored row without the field reads as null.
- Do not add an attestation link for `failed` or `no_verdict`.

## Review Focus

- **The OutLayer API throws or times out:** the invoice read still answers 200 with `jobId` null. Test in 1.2.
- **A job with the same tx but a different request id:** it must not be linked. Test in 1.1.
- **Polling:** reads every 5 s for a minute make at most 2 jobs-API calls. Test in 1.2.
- **Old stored evidence with no `jobId` field:** it is looked up and then stored. Test in 1.2.
- **`failed` evidence that has a `jobId`:** the UI still shows no attestation link. Tests in 2.1 and 2.2.

---

## 1. Relay

- [x] 1.1 Add the OutLayer jobs client and `findJob`; verify `cd relay && node --test src/screening.test.ts` passes
  - **Files:**
    - `relay/src/types.ts`:
      - Add `interface OutLayerApi { jobs(q: {user: string; project: string; limit: number; offset: number}): Promise<any[]> }`.
      - `Deps` gains `outlayer: OutLayerApi`.
      - `Config` gains `outlayerApi` from `OUTLAYER_API`.
    - `relay/src/main.ts`: add `outlayerApi(baseUrl)`, using `fetch` with `AbortSignal.timeout(5000)`. A non-2xx reply throws.
    - `relay/src/testing.ts`: add `fakeOutLayer()` with `jobList: any[]`, `calls`, and an optional `fail: Error`. It pages `jobList` by `limit` and `offset`.
    - `relay/src/fixtures/outlayer-jobs.json`: record the live response of `public/jobs?user_account_id=relay.gateflow.near&project=ops.gateflow.near/gateflow&limit=50`. It contains job 1255332, request 2796, tx `C8UdBVpFo4kNQUU1tWivMeSKGkU3SYu5DNADuQCi35RS`.
  - **Produces:** `findJob(deps, q: {txHash: string; signer: string; requestId: number}): Promise<number | null>`, in `relay/src/screening.ts`. Errors return null.
  - **Tests:**
    - `find_job_fixture`: returns 1255332.
    - `find_job_request_mismatch`: same tx with `requestId` 9999 returns null.
    - `find_job_pages`: the job sits at index 120 of 160, so it is found on the third call.
    - `find_job_page_cap`: the job sits at index 250, so the result is null after 4 calls.
    - `find_job_api_error`: returns null.
  - **Commit:** `feat(relay): find OutLayer job of a screening`
- [x] 1.2 Add `jobId` to evidence, with a throttled retry; verify `cd relay && npm test` passes
  - **Files:** `relay/src/screening.ts` (`Screening.jobId`, `evidenceFor`), `relay/src/screening.test.ts`, `relay/src/checkout.test.ts`.
  - **Behavior:** at the end of `evidenceFor`, when `s.requestId !== null && !s.jobId` and the payment's last try was at least 60 s ago, call `findJob` with `{txHash: row.tx_hash, signer: row.sender, requestId}`. If a job is found, set `jobId`, and call `storeEvidence` when the payment is not Pending. Otherwise set `jobId: null`.
  - **Tests:**
    - `job_id_stored`: a Settled payment's evidence gets `jobId` 1255332 and it is stored. A second read makes no jobs call.
    - `job_retry_throttled`: the first read finds none; a read at +30 s makes no call; a read at +61 s finds the job and stores it.
    - `legacy_evidence_filled`: stored evidence without a `jobId` field is filled in on read.
    - `outlayer_down_invoice_ok`: with `fakeOutLayer().fail` set, `GET /checkout/invoice` answers 200 with `screening.jobId` null.
  - **Docs:** add the `OUTLAYER_API` row to the `README.md` env table. In `enclave/README.md` "Execution attestations", say the relay now resolves `job_id` and links the attestation.
  - **Commit:** `feat(relay): OutLayer job id in screening evidence`

## 2. Web

- [x] 2.1 Add the attestation link on checkout; verify `cd web && npx vitest run src/checkout` passes
  - **Files:** `web/src/checkout/logic.ts` (`Screening.jobId`, `attestationUrl`, `screeningDetail`), `logic.test.ts`.
  - **Produces:** `attestationUrl(jobId: number, network: string): string`.
  - **Behavior:** in `screeningDetail`, for `approved`, `rejected` and `pending` with a `jobId`, the second link becomes `{label: "TEE attestation", href: attestationUrl(...)}`.
  - **Tests:**
    - `detail_attestation_link`: with `jobId` 1255332 on mainnet, the link is `https://app.outlayer.ai/attestation/1255332?network=mainnet`, labeled `TEE attestation`.
    - `detail_failed_no_attestation`: `failed` with a `jobId` has no attestation link.
    - Existing tests get `jobId: null` in their fixtures and still pass.
  - **Commit:** `feat(web): link checkout screening to its attestation`
- [x] 2.2 Add the attestation link in the console; verify `cd web && npx vitest run src/console` passes
  - **Files:** `web/src/console/logic.ts` (`screeningFields`), `logic.test.ts`.
  - **Behavior:** the Request field's `href` is `attestationUrl(jobId, network)` when `jobId` is set, and `OUTLAYER_EXECUTIONS` otherwise.
  - **Tests:**
    - `fields_request_attestation`: the Request href is the attestation URL for job 1255332.
    - `fields_no_verdict`: still has no Request field.
  - **Commit:** `feat(web): link console request to its attestation`

## 3. Integration

- [x] 3.1 Check against mainnet. Run the relay locally against `gateflow.near`, as in the screening-transparency check, with payment 0's stored evidence that has no `jobId`. Verify `GET /checkout/invoice?id=0` returns `screening.jobId` 1255332, and that `https://app.outlayer.ai/attestation/1255332?network=mainnet` answers 200. Then verify `cd relay && npm test` and `cd web && npm test && npm run build` pass.

## Workflow follow-up

- Archive with `/opsx:archive outlayer-attestation-link` after review.
