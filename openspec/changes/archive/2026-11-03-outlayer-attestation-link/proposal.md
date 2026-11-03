# Proposal

## Why

Checkout and console link a screening to `app.outlayer.ai/executions` with the on-chain `request_id`, but OutLayer keys attestations by its own `job_id`, which differs (request 2796 is job 1255332). The payer and merchant must hunt for the run. OutLayer's `public/jobs` API maps a tx to its job, so each screening can link straight to its TDX attestation page.

## What Changes

- **Job lookup (relay):** for a payment with a recorded screening tx, find the OutLayer job whose `transaction_hash` matches. Query `GET <OUTLAYER_API>/public/jobs` for the tx signer and project, newest first, paging up to a fixed bound. Accept the match only when its `request_id` equals the evidence's request id.
- **Evidence gains `jobId`:** stored with the evidence once found. If the job is not found yet, the evidence keeps `jobId: null` and the lookup is retried at most once a minute per payment. Evidence stored before this change, such as payment 0, is filled in on its next read.
- **Attestation link:** checkout and console link to `https://app.outlayer.ai/attestation/<jobId>?network=<mainnet|testnet>` when `jobId` is known. Otherwise they keep the `app.outlayer.ai/executions` link.
- **Config:** new relay env `OUTLAYER_API` (default `https://api.outlayer.ai`; testnet `https://testnet-api.outlayer.ai`).
- **Docs:** `enclave/README.md` "Execution attestations" says the lookup is now wired.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `screening-evidence`: evidence carries the OutLayer `jobId`, resolved from OutLayer's jobs API and retried until found.
- `payer-checkout`: the Screening in enclave step links to the execution's attestation when its job is known.
- `merchant-console`: the invoice Screening block links the request to its attestation when its job is known.

## Impact

- **`relay/`:** `screening.ts` (job lookup, `jobId` in evidence, throttle), `types.ts` (`OUTLAYER_API`), `testing.ts` (fake fetch for the jobs API), tests with a recorded `public/jobs` fixture.
- **`web/`:** `checkout/logic.ts` (`attestationUrl`, `screeningDetail` links), `console/logic.ts` (`screeningFields`).
- **New runtime dependency:** an undocumented OutLayer HTTP API. If it fails or changes, the links fall back to the executions list and nothing else breaks.
- **No change** to the contract or the enclave.
