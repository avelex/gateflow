# Remove KYC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. OpenSpec tracks only the `- [ ] N.M` lines; the numbered steps under each task are its cycle and are not tracked separately.

**Goal:** Remove Sumsub KYC (attestations, identity policy, spend limit, token minting) from contract, enclave, relay and docs, leaving KYT screening unchanged.

**Architecture:** Pure deletion plus one type change: `Policy` becomes `{ max_risk: u8 }`. Screening, `ref` payments, `screen_intents`, settle/refund/retry are untouched. The parked `screen-cross-chain-payer` change is trimmed so both changes stay archivable.

**Tech Stack:** Rust near-sdk 5.27 (`contract/`), Rust `wasm32-wasip2` OutLayer guest (`enclave/`), TypeScript on Node 26 built-ins (`relay/`).

**Spec:** `openspec/changes/remove-kyc/specs/*/spec.md`, `openspec/changes/remove-kyc/design.md`.

## Global Constraints

- A policy is `{"max_risk": <0..80>}`; `max_risk > 80` fails with "risk cap too high".
- Contract `Key` enum becomes `Gateways, Payments, Refs` (fresh deployment only).
- No remaining reference to Sumsub, attestations, nullifiers, verification levels, threshold or spend limit in `contract/src`, `enclave/src`, `relay/src`. Historical tx records in GOAL.md "Testnet deployment (2026-10-25)" stay as they are.
- `SUMMARY.md` has uncommitted edits by the user. Edit the working copy without discarding them, and ask before committing it.
- Commits: short conventional style, one per task.

## Review Focus

- A payment above the old threshold from a payer who never verified is accepted and screened (Pending, fuel drawn), not rejected. Test `large_payment_needs_no_identity` (1.1).
- A policy JSON that still carries `level_below`/`level_above`/`threshold` deserializes, the extra fields are ignored, and `max_risk` is kept. Test `legacy_policy_fields_ignored` (1.1).
- A duplicate `ref` still refunds in the same call. Existing test `duplicate_ref_refunds` (1.1) must stay green.
- The relay starts with no `SESSION_ID_SECRET` or `SUMSUB_*` in the environment, and `POST /relay/token` answers 404. Checked in 3.1.
- `screen-cross-chain-payer` still validates after its identity block is removed. Checked in 4.1.

---

## 1. Contract

- [x] 1.1 Remove identity from the contract; verify `cd contract && cargo test` passes 17 tests, the release build succeeds, and `grep -n -i -E "attest|nullifier|level_|threshold|fn verify|revoke|spend|MAX_LEVEL" contract/src/*.rs` prints only the JSON string inside `legacy_policy_fields_ignored`

  **Files:** `contract/src/interface.rs`, `contract/src/lib.rs` (tests module included).
  **Interfaces (produces):** `pub struct Policy { pub max_risk: u8 }`. The `Gateflow` trait keeps `create_gateway`, `set_policy`, `fund`, `set_enclave_project`, `ft_on_transfer`, `on_screened`, `screen_intents`, `reclaim`, `on_closed`, `retry`, `get_gateway`, `get_payment` and `get_payment_by_ref`. `revoke`, `verify`, `on_verified`, `get_attestation` and `is_verified` are removed.

  1. Rewrite the tests first.
     - `setup(level: u8)` becomes `setup()` with `Policy { max_risk: 80 }`.
     - `pay` takes the amount: `pay(contract, msg, amount: u128)`. Existing callers pass `500_000`.
     - Delete `identity_gated_ref_payment_refunds`.
     - Add:
       - `large_payment_needs_no_identity`: `pay(&mut c, r#"{"gateway":0}"#, 50_000_000_000)`, then the payment is `Pending` and fuel equals `FUEL - DEPOSIT`.
       - `risk_cap_too_high_rejected`: `#[should_panic(expected = "risk cap too high")]` on `create_gateway(.., Policy { max_risk: 90 })`.
       - `legacy_policy_fields_ignored`: `serde_json::from_str::<Policy>(r#"{"level_below":1,"level_above":2,"threshold":"5","max_risk":70}"#).unwrap().max_risk == 70`.
  2. Run `cargo test`. Expected: compile errors, because `Policy` has no field `max_risk` alone and `pay` takes 3 arguments.
  3. Implement (design.md "Context" lists every symbol).
     - `interface.rs`: `Policy { max_risk }`. Delete `Attestation`, `Spend`, `Nullifier`, `EnclaveRequest::Verify`, and the five trait methods.
     - `lib.rs`:
       - Delete the constants `VERIFIED_CALLBACK_GAS`, `SPEND_WINDOW_SEC`, `MAX_LEVEL` and `MAX_THRESHOLD`.
       - Shrink `Key` to `Gateways, Payments, Refs`, and delete the fields `attestations`, `revoked` and `spent`.
       - Delete the methods `revoke`, `verify`, `on_verified`, `get_attestation`, `is_verified`, `valid_attestation` and `enforce_policy`.
       - In `ft_on_transfer`, the `ref` branch rejects only a duplicate `ref`, and the non-`ref` branch drops the `enforce_policy` call.
       - `validate()` keeps only the `max_risk <= MAX_RISK` check.
  4. Run `cargo test`. Expected: 17 passed, no warnings. Then run `cargo build --target wasm32-unknown-unknown --release` and the `grep` from the task line.
  5. Commit `refactor(contract)!: remove KYC, keep KYT policy`.

## 2. Enclave

- [x] 2.1 Remove the `Verify` path and its dependencies; verify `cd enclave && cargo test` passes 20, `cargo build --target wasm32-wasip2 --release` succeeds, and both `cargo tree -e normal | grep -E "hmac|sha2"` and `grep -n -i -E "sumsub|attest|nullifier|session" src/*.rs` print nothing

  **Files:** `enclave/src/main.rs`, `enclave/src/interface.rs`, `enclave/Cargo.toml`, `enclave/Cargo.lock`.

  1. Delete from `interface.rs`: `EnclaveRequest::Verify`, `Attestation`, `IdentityDocument`, `IdentityProvider`, `Secrets`.
  2. Delete from `main.rs`:
     - The `Verify` match arm.
     - `Sumsub` and its `IdentityProvider` impl.
     - `EnclaveSecrets` and its `Secrets` impl.
     - The functions `field`, `hmac_hex` and `now_sec`.
     - The constants `SUMSUB_URL`, `SUMSUB_LEVEL` and `ATTESTATION_TTL_SEC`.
     - The `hmac`, `sha2` and `SystemTime` imports.
  3. Remove `hmac` and `sha2` from `Cargo.toml`, then run `cargo build` to refresh `Cargo.lock`.
  4. Run the three checks from the task line. Expected: 20 passed, build `Finished`, both greps empty.
  5. Commit `refactor(enclave)!: remove Sumsub verify path`.

## 3. Relay

- [x] 3.1 Remove Sumsub, session ids and identity gating; verify `node --test relay/src/*.test.ts` passes 9, then check the live relay as described below

  **Files:** `relay/src/main.ts`, `relay/src/interfaces.ts`.
  **Interfaces (produces):** `interface Policy { maxRisk: number }`. `SessionIds` and `SumsubTokens` are removed.

  1. In `interfaces.ts`: `Policy` keeps only `maxRisk`. Delete `SessionIds` and `SumsubTokens`.
  2. In `main.ts`, delete:
     - The `createHmac` import.
     - The constants `SUMSUB_URL`, `TOKEN_MINTS_PER_HOUR` and `HOUR_MS`.
     - The settings `SESSION_ID_SECRET`, `SUMSUB_RELAY_APP_TOKEN`, `SUMSUB_RELAY_SECRET_KEY` and `SUMSUB_LEVEL_NAME`.
     - `sessionIds`, `sumsub()`, `sumsubTokens`, `mintsByIp`/`allowMint`, and the `"POST /relay/token"` route.
     - The `requiredLevel` check in `intents.quote`.

     `gateways.get` then maps `policy: { maxRisk: max_risk }`.
  3. Run `node --check relay/src/main.ts` and `node --test relay/src/*.test.ts`. Expected: 9 pass.
  4. Start the relay with only `GATEFLOW_CONTRACT=intents.near NEAR_RPC_URL=<stub>`. The stub NEAR RPC serves `get_gateway` as `{"token":"17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1","policy":{"max_risk":80},…}`. Expected:
     - The process starts.
     - `POST /relay/token` answers 404 `{"error":"not found"}`.
     - A Base USDC `POST /checkout/quote` for `"amount":"50000000000"` returns 200 with a `ref`, not 422.
  5. Commit `refactor(relay)!: remove Sumsub token minting`.

## 4. Parked change

- [x] 4.1 Trim identity from `screen-cross-chain-payer`; verify `openspec validate screen-cross-chain-payer --strict` passes and that `grep -n -i -E "identity|attestation" openspec/changes/screen-cross-chain-payer/specs/*/spec.md` prints nothing
  1. In `specs/payment-clearing/spec.md`, delete the whole MODIFIED block `### Requirement: Identity policy enforced at deposit`, together with its scenarios.
  2. In `design.md` decision 4, replace "An identity-gated amount or a duplicate `ref`" with "A duplicate `ref`".
  3. In `tasks.md` task 2.1, append the note "(`identity_gated_ref_payment_refunds` removed later by `remove-kyc`)".
  4. Commit `docs(openspec): drop identity from screen-cross-chain-payer`.

## 5. Docs

- [x] 5.1 Remove KYC from `README.md` and `GOAL.md`; verify that `grep -n -i -E "kyc|sumsub|nullifier|SESSION_ID|identity" README.md` prints only the "No KYC" note, and that `GOAL.md` matches only the `remove-kyc` reference in P1.3 and its "Testnet deployment (2026-10-25)" section
  - README:
    - Modules row `enclave/` drops `verify (Sumsub KYC to nullifier)`.
    - Add a note under the diagram: "No KYC: there is no per-person limit; large payments are gated only by screening."
  - GOAL:
    - P1.3 (identity path) becomes "~~…~~ removed by `remove-kyc` (KYT only)".
    - The "Turn on the enclave" secrets list drops the Sumsub, session-id and nullifier entries.
    - "Enclave crypto" is deleted.
    - The runbook relay rows drop `SESSION_ID_SECRET` and `SUMSUB_*`.
    - Mainnet runbook step 5 uses the policy `{"max_risk":80}`; step 7 drops the identity note.
    - The Known gaps line about the spend counter is deleted.
    - The Risks row "No Sumsub sandbox keys" is deleted.
  - Commit `docs: remove KYC from README and GOAL`.
- [x] 5.2 Remove KYC claims from `SUMMARY.md` on top of the user's uncommitted edits; verify `grep -n -i -E "kyc|sumsub|nullifier" SUMMARY.md` prints nothing and that `git diff SUMMARY.md` still contains the user's earlier hunks
  - Edit only the lines that mention KYC, Sumsub, nullifiers or identity. Rephrase the claims as KYT-only. Leave the privacy-track pitch line as "TBD (see deferred options)".
  - Do not commit. Ask the user whether to commit `SUMMARY.md` together with their own edits.

## 6. Integration

- [x] 6.1 Run every check together and verify all pass:
  - `cd contract && cargo test` (17)
  - `cd enclave && cargo test` (20)
  - `node --test relay/src/*.test.ts` (9)
  - Both release builds
  - `openspec validate --all --strict`

## Workflow follow-up

- Archive `remove-kyc` with `/opsx:archive remove-kyc` after review. The change retires the `identity-attestation` main spec, because `.openspec.yaml` sets `retire_capabilities: true`.
- `screen-cross-chain-payer` stays parked until mainnet and is archived after this one.
