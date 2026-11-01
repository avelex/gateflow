# Proposal

## Why

`openspec/specs/` is empty, while the contract, enclave and relay already implement Gateflow's core flow and are deployed to testnet. Upcoming changes (cross-chain payer screening, multi-chain payout) need a baseline to write deltas against, so this change records the behavior that exists today without changing any code.

## What Changes

- Document current behavior as specs. No code, API or deployment changes.
- Record known gaps as they are, not as fixed. For example, screening reads the NEAR `sender_id`, so a 1Click delivery screens the Intents contract rather than the origin-chain payer.

## Capabilities

### New Capabilities

- `merchant-gateways`: per-merchant gateway records: owner, payout account, accepted NEP-141 token, compliance policy, and prepaid screening fuel.
- `payment-clearing`: escrow of incoming NEP-141 payments, policy enforcement at deposit, TEE screening through OutLayer, and settlement to the merchant or refund to the payer, including the clearing-window reclaim.
- `identity-attestation`: KYC verification inside the TEE that stores only a per-gateway nullifier and level on chain, plus expiry and merchant revocation.
- `checkout-relay`: stateless HTTP relay that mints Sumsub WebSDK tokens and requests NEAR Intents 1Click quotes that deliver into a gateway.

### Modified Capabilities

None.

## Impact

- Code: none. Specs describe `contract/`, `enclave/` and `relay/` as of the initial import.
- Archiving this change creates the first files under `openspec/specs/`.
- Later changes (starting with cross-chain payer screening) will modify `payment-clearing` and `checkout-relay`.
