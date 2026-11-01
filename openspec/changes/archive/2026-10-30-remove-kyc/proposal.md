# Proposal

## Why

Gateflow currently combines KYT (screening the payer's addresses) with KYC: Sumsub verification inside the TEE, nullifier attestations, identity-gated amounts and a per-person 24-hour spend limit. The KYC path needs Sumsub credentials, has never run live, and blocks nothing the hackathon demo needs. Keeping only KYT shrinks the contract, the enclave and the relay before the first mainnet deployment.

## What Changes

- **BREAKING** Remove identity verification from the contract: `verify`, `on_verified`, `revoke`, `get_attestation` and `is_verified`, together with attestation, revocation and spend storage.
- **BREAKING** A gateway policy keeps only `max_risk`. `level_below`, `level_above` and `threshold` are gone, so no payment amount requires identity.
- **BREAKING** Remove the 24-hour per-person spend limit, which was keyed by the identity nullifier.
- `ref` payments no longer have an identity-gated refund branch. A duplicate `ref` is still opened and refunded.
- Remove the enclave's `verify` request and its Sumsub client, along with the session-id and nullifier secrets and their HMAC dependencies.
- **BREAKING** Remove the relay's `POST /relay/token` route, its Sumsub client and rate limit, the identity-gated quote refusal, and the `SESSION_ID_SECRET` and `SUMSUB_*` settings.
- Remove the identity references from the parked `screen-cross-chain-payer` change, so it can still be archived after this change.
- Trim KYC claims from the README, SUMMARY and GOAL.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `identity-attestation`: retired. Every requirement is removed.
- `payment-clearing`: identity policy at deposit and the 24-hour spend limit are removed.
- `merchant-gateways`: policy validation covers only the risk cap.
- `checkout-relay`: Sumsub token minting, its rate limit and the identity-gated quote refusal are removed.

## Impact

- `contract/`: `interface.rs` and `lib.rs` lose the identity types, methods, storage keys and constants. The storage layout changes, which needs a fresh deployment. The mainnet deployment planned in `screen-cross-chain-payer` is fresh anyway.
- `enclave/`: `main.rs` and `interface.rs` lose the `Verify` path. `Cargo.toml` drops `hmac` and `sha2`. OutLayer no longer needs the Sumsub, session-id or nullifier secrets.
- `relay/`: `main.ts` and `interfaces.ts` lose the Sumsub, session-id and policy-level code. Only `GATEFLOW_CONTRACT` and the relay key are required to start.
- `openspec/changes/screen-cross-chain-payer/`: its `payment-clearing` delta drops the "Identity policy enforced at deposit" block, and its design drops the identity-gated case.
- Docs: README, SUMMARY and GOAL. The Privacy & Private AI track loses its "identity never leaves the TEE" claim; a replacement pitch is deferred.
- Out of scope: new screening sources, the replacement privacy pitch, the mainnet deployment.
