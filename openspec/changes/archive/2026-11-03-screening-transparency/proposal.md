# Proposal

## Why

Checkout and the console say a payment is "screened in an enclave", but nothing shows what ran, where it ran, or that it ran for this payment. The evidence is already public: every screening tx carries OutLayer `execution_requested` / `execution_completed` events with the request id, the wasm hash that ran, its run time and cost, and `outlayer.near.get_project` returns the active code hash. Surfacing it lets payers and merchants check the claim instead of trusting copy.

## What Changes

- **Screening evidence (relay):** record the NEAR tx that ran each payment's screening, parse its `outlayer.near` events into `{requestId, wasmHash, timeMs, cost, outcome}`, cache it once final, and classify payments returned without a verdict (OutLayer execution failed, or `reclaim` after the clearing window).
- **Direct-pay tx report:** new `POST /checkout/tx {invoice, txHash}`. The checkout sends the wallet's tx hash; the relay accepts it only if RPC shows the tx signed by the payment's payer and holding that payment's `payment_opened` event. Cross-chain hashes come from `submitScreening`.
- **Checkout invoice details:** `GET /checkout/invoice` gains `enclave {project, activeVersion}` (live from `outlayer.near.get_project`, cached 60 s) and `screening` (evidence or null).
- **Payer checkout:** a collapsible "How screening works" before payment (checks run, OutLayer Intel TDX enclave, current wasm hash with source link); the "Screening in enclave" timeline row shows request id, wasm hash and run time with links to the NEAR explorer tx and OutLayer executions; no-verdict returns get their own copy and never claim a run.
- **Merchant console:** the invoice Details section gains a Screening block (flow, risk limit, deposit address, project, wasm hash, request id, run time, cost, tx and OutLayer links). Console payments carry the same `screening` object.
- **Spike:** find an OutLayer per-execution deep link or attestation API; until then link to `app.outlayer.ai/executions` and show the request id.

## Capabilities

### New Capabilities

- `screening-evidence`: the backend's per-payment record of the screening tx and the OutLayer execution evidence parsed from it, including no-verdict classification.

### Modified Capabilities

- `checkout-relay`: invoice details gain `enclave` and `screening`; new direct-pay tx report endpoint; deferred screening records its tx.
- `payer-checkout`: invoice page explains screening with live code hash; status timeline shows per-run evidence and no-verdict copy.
- `merchant-console`: invoice details show the screening block.

## Impact

- **`relay/`:** `screenings` table in `db.ts`; tx status RPC in `near.ts`; evidence parser; `checkout.ts` (invoice, new `POST /checkout/tx`, `submitScreening`); `console.ts` payments; new env `OUTLAYER_PROJECT` (default `ops.gateflow.near/gateflow`) and `OUTLAYER_CONTRACT` (default `outlayer.near`).
- **`web/`:** `checkout/Checkout.tsx`, `NearPay.tsx`, `wallet.ts`, `logic.ts`; `console/cards.tsx`.
- **No change** to `contract/` or `enclave/`; ships independently of the `mainnet-launch` redeploy.
- **Out of scope:** indexer fallback for unreported direct-pay hashes, pinning `version_key`, verifying TDX quotes in our UI, enclave reason codes.
