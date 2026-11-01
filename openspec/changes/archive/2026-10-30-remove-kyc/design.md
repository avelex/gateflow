# Design

## Context

See proposal.md, "Why". KYC code exists in all three modules:

```
contract  interface.rs: Policy.level_below/level_above/threshold, Attestation, Spend, Nullifier,
                        EnclaveRequest::Verify, trait methods revoke/verify/on_verified/
                        get_attestation/is_verified
          lib.rs:       VERIFIED_CALLBACK_GAS, SPEND_WINDOW_SEC, MAX_LEVEL, MAX_THRESHOLD,
                        Key::Attestations/Revoked/Spent, fields attestations/revoked/spent,
                        valid_attestation, enforce_policy, level checks in validate(),
                        identity branch in the ref path of ft_on_transfer
enclave   main.rs:      Verify arm, Sumsub + IdentityProvider, EnclaveSecrets + Secrets,
                        hmac_hex, field, now_sec, SUMSUB_* / ATTESTATION_TTL_SEC consts
          interface.rs: Verify, Attestation, IdentityDocument, IdentityProvider, Secrets
          Cargo.toml:   hmac, sha2 (used only by the above)
relay     main.ts:      sumsub(), sessionIds, sumsubTokens, mint rate limit, POST /relay/token,
                        SESSION_ID_SECRET / SUMSUB_* settings, requiredLevel check in quote
          interfaces.ts: Policy levels/threshold, SessionIds, SumsubTokens
```

`screen-cross-chain-payer` is parked until mainnet. Its `payment-clearing` delta MODIFIES "Identity policy enforced at deposit", which this change REMOVES.

## Goals / Non-Goals

**Goals:**
- No KYC code, types, storage, settings or secrets remain; screening (KYT) behaviour is unchanged.
- Both changes stay archivable, in either order after this one lands.

**Non-Goals:**
- Feature-flagging KYC for later return (git history keeps it).
- Changing screening sources or the privacy-track pitch.
- Migrating deployed state.

## Decisions

1. **Delete, don't disable.** A flag would keep dead code compiling and tested for a feature with no credentials. Restoring KYC is a revert plus a new change.
2. **`Policy` becomes `{ max_risk: u8 }`, kept as a struct.** It keeps `create_gateway(payout_to, token, policy)` and `set_policy` signatures and the JSON shape `{"policy": {"max_risk": 80}}`.
   - Rejected: inline `max_risk` on `Gateway`, which changes two method signatures for no gain.
3. **Storage keys are rewritten, not reserved.** `Key` becomes `Gateways, Payments, Refs`. Borsh prefixes change, which is safe only on a fresh account. Mainnet is fresh, and `gateflow-f604a6.testnet` is not upgraded in place (already a constraint of `screen-cross-chain-payer`).
4. **The `ref` path keeps one deposit-time refund: a duplicate `ref`.** Without levels, the identity-gated branch disappears. `ft_on_transfer` for `ref` payments still never panics after the gateway and token checks.
5. **Edit the parked change, don't rebase it.** Delete the MODIFIED "Identity policy enforced at deposit" block from `screen-cross-chain-payer/specs/payment-clearing/spec.md` and the identity case from its design decision 4. Its done task 2.1 keeps its history, with a note that `remove-kyc` removed the identity test.
6. **`SUMMARY.md` has uncommitted edits by the user.** Edit the working copy in place and leave those edits intact. Commit `SUMMARY.md` only after asking the user, because the commit would include their unrelated edits.

## Risks / Trade-offs

- [No per-person limit: a flagged-clean payer can move any amount] → accepted for KYT-only; stated in README.
- [The Privacy & Private AI track loses its identity claim] → deferred; the options are recorded outside this change.
- [Archive order] → this change must be archived before `screen-cross-chain-payer`, which is fine because that one waits for mainnet. If the parked change were archived first, its identity MODIFIED block would be removed by task 4.1 anyway, so either order works once 4.1 is done.

## Migration Plan

There is no live state to migrate: the testnet contract keeps the old code, and the mainnet deployment is fresh. OutLayer secrets drop `SUMSUB_APP_TOKEN`, `SUMSUB_SECRET_KEY`, `SESSION_ID_SECRET` and `NULLIFIER_SECRET`. The relay environment drops `SESSION_ID_SECRET` and `SUMSUB_*`. Rollback: `git revert` of this change's commits.
