# Proposal

## Why

The landing now shows Solana as a payer network, but the relay answers 422 for any Solana quote and the enclave refunds any Solana-origin payment. Solana is one of the largest USDC chains on 1Click. Supporting it closes the gap between what the landing claims and what checkout does before judging starts on 2026-11-16.

## What Changes

- The enclave gains a Solana branch in `screen_intents`. It reads each origin deposit transaction from a fixed public Solana RPC, takes every signer account as a sender, and checks each one against the OFAC sanctioned Solana address list. A listed signer counts as risk 100, any other signer as 0. A missing transaction, a transaction with no signers or a failed lookup fails closed.
- The relay treats `sol` as a screenable origin. It quotes Solana assets, lists them in `GET /checkout/assets`, and resolves Solana signers as origin senders for the console.
- The checkout offers Solana as a network wherever 1Click lists the invoice's asset on Solana (for example USDC), with a Solana refund-address placeholder.
- The console's Settings lists Solana among the read-only payer origins.
- The landing-page spec catches up with the shipped deck: slides 1 and 3 name NEAR, Ethereum, Solana, Bitcoin and Zcash.
- No contract change. `gateflow.near` has no upgrade path, and it needs none: the contract requests the OutLayer project's active version (`version_key: null`), and it carries no chain logic. The new enclave version goes live with `outlayer deploy`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `payment-clearing`: Solana becomes a supported origin for deferred screening, with a new requirement that Solana senders are every signer checked against OFAC. The Solana RPC endpoint is fixed at build time, like the EVM RPCs.
- `checkout-relay`: Solana is a screenable origin for quotes and quotable assets. The watcher resolves Solana signers as origin senders.
- `merchant-console`: Settings lists Solana among payer origins.
- `landing-page`: slides 1 and 3 name NEAR, Ethereum, Solana, Bitcoin and Zcash instead of Base, Ethereum, Arbitrum, Bitcoin, Zcash and NEAR.

## Impact

- `enclave/src/origin.rs`, `ofac.rs`, `flows.rs` and new fixtures. A new wasm build is deployed to OutLayer mainnet project `ops.gateflow.near/gateflow`. The new wasm hash shows in every later screening attestation.
- `relay/src/checkout.ts` (`screenable`), `relay/src/origin.ts` (Solana request, parser and chain name). Then a relay redeploy on Fly.io.
- `web/src/checkout/CrossChainPay.tsx` (refund placeholder). `web/src/assets.ts` already maps `sol` to Solana and its icon.
- External services: a public Solana JSON-RPC endpoint and the 0xB10C `sanctioned_addresses_SOL.txt` list. The list holds four addresses today, so Solana screening is sanctions-only, like Bitcoin and Zcash.
- Verification needs one small Solana USDC payment on mainnet.
