# BYOK Screening Keys Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. OpenSpec tracks only the `- [ ] N.M` lines; the numbered steps under each task are its TDD cycle and are not tracked separately.

**Goal:** Merchants seal their own Chainalysis Sanctions key into the OutLayer enclave, and screenings of their gateway use it. Gateflow never sees the key.

**Architecture:**
- The contract pins `secrets_ref.account_id` to the gateway owner, with an owner-chosen profile.
- The enclave drops operator secrets: the contract id is fixed at build time and the RPCs are compiled in. When `CHAINALYSIS_API_KEY` is present, the enclave adds a Chainalysis score per screened address.
- The console seals the key in the browser and stores it with passkey-signed delegate actions. The relayer allowlist admits the OutLayer calls, and the operator pre-funds the storage deposit.

**Tech Stack:** Rust near-sdk 5 (`contract/`), Rust `wasm32-wasip2` with `wasi-http-client` (`enclave/`), Node 26 built-ins (`relay/`), React and Vitest (`web/`).

**Spec:**
- `openspec/changes/byok-screening-keys/specs/{screening-providers,merchant-gateways,payment-clearing,sponsored-transactions,merchant-console}/spec.md`
- `openspec/changes/byok-screening-keys/design.md`

## Global Constraints

- **Order:** apply after `contract-invoices-views` and `web-console-checkout`. Stop after group 1 if the stop condition in design decision 1 holds.
- **Secrets profile:** name regex `^[a-z0-9_-]{1,32}$`. The merchant profile is always `gateflow`. The account is always `gateway.owner`, and the fallback is `{"default", secrets_owner}`.
- **Enclave env reads:** only `CHAINALYSIS_API_KEY`, `ONECLICK_API_KEY` and `NEAR_PREDECESSOR_ID`. `GATEFLOW_CONTRACT` comes from `env!` at build time.
- **EVM RPC defaults:**
  - `base` → `https://base-rpc.publicnode.com`
  - `eth` → `https://ethereum-rpc.publicnode.com`
  - `arb` → `https://arbitrum-one-rpc.publicnode.com`
- **Chainalysis:** a non-empty identification list scores 100, an empty list scores 0, and any failure gives `None`, which fails closed. Per address: `max(builtin, chainalysis)`.
- **Allowlist additions:**
  - Gateflow `set_secrets` with zero deposit.
  - `OUTLAYER_CONTRACT` `store_secrets`/`delete_secrets` with a deposit of at most 0.1 NEAR (`100000000000000000000000` yocto), `profile === "gateflow"`, and at most 100 Tgas.
- **Deposit pre-funding:** 0.1 NEAR when the balance is below it, once per merchant per UTC day, 429 after that.
- **Backend storage:** the provider name and the last 4 characters of the key only. Never log request bodies on `/console/byok*`.
- **Commits:** short conventional style, one per task.

## Review Focus

- **A gateway with a profile whose secret was deleted outside Gateflow:** screening must fail closed, not pass. Test `missing_provider_key_uses_builtin_only` (3.2) pins the no-key behavior. 6.1 checks the deleted-secret case live.
- **Profile cleared between payment open and `screen_intents`:** must use `default`. Test `secrets_ref_read_at_screening_time` (2.1).
- **A `store_secrets` delegate naming another merchant's profile or another accessor:** 403. Tests `store_secrets_other_profile_refused` and `store_secrets_over_deposit_refused` (4.1).
- **Chainalysis answering 200 with a non-JSON body (an HTML error page):** fail closed. Test `chainalysis_unparsable_fails` (3.2).
- **BTC deposit with several inputs where only one is identified:** refund. Test `one_identified_sender_fails` (3.2).

---

## 1. Spikes

- [ ] 1.1 Pin down the OutLayer secret-storing path, and verify by updating design.md decision 4 and Context with the exact values below. Either confirm that the stop condition does not hold, or stop the change and report.
  1. Read the `outlayer-cli` source for `get_secrets_pubkey` (`crate::api`) and the access parsing in the latest version. Record:
     - the endpoint URL, method and request body;
     - whether `secrets_json` (plaintext) is sent;
     - the cipher and key format;
     - the JSON for a condition admitting executions requested via a contract (`Predecessor`/`--via`).
  2. On testnet, store a dummy secret with `outlayer secrets set` for the Gateflow enclave project, profile `gateflow`, from a test account. Capture the `store_secrets` transaction args.
  3. Run a test execution through the Gateflow contract with that `secrets_ref` and confirm the enclave sees the variable. Also confirm whether a secret named `NEAR_PREDECESSOR_ID` overrides the worker's value.
  4. From a browser page on `localhost`, call the keystore endpoint and record whether CORS allows it.
  5. Commit `docs(openspec): record OutLayer secrets spike`.
- [ ] 1.2 Record Chainalysis fixtures, and verify with `jq -e '.identifications | length > 0' enclave/tests/fixtures/chainalysis-hit.json` and `jq -e '.identifications == []' enclave/tests/fixtures/chainalysis-clean.json`.
  1. Get a free Sanctions API key. Query an OFAC-listed ETH address from the 0xB10C list and a clean one, plus one BTC address. Save the bodies as `chainalysis-hit.json`, `chainalysis-clean.json` and `chainalysis-btc-clean.json`.
  2. Record the exact URL, header and status codes (including 401 for a bad key) in design decision 5.
  3. Commit `test(enclave): chainalysis fixtures`.

## 2. Contract

- [ ] 2.1 Add the gateway secrets profile. Verify that `cd contract && cargo test` passes `set_secrets_owner_only`, `set_secrets_invalid_name`, `set_secrets_clear`, `execute_uses_owner_profile`, `execute_default_without_profile` and `secrets_ref_read_at_screening_time`, and that the release build succeeds.
  1. In `interface.rs`, add `Gateway.secrets_profile: Option<String>` and the trait method `set_secrets(&mut self, gateway: GatewayId, profile: Option<String>)`.
  2. In `lib.rs`, implement `set_secrets` through `owned_gateway`, with the validation panic "invalid secrets profile".
  3. Change `execute(request, deposit, refund_to)` to `execute(request, deposit, gateway: &Gateway)`, which builds `secrets_ref` per design decision 2. Update both call sites.
  4. Tests assert on the JSON args in the `request_execution` promise. Use the existing promise-inspection approach, or add `fn secrets_ref(&Gateway, &AccountId) -> Value` as a tested pure helper.
  5. Commit `feat(contract): per-gateway secrets profile`.

## 3. Enclave

- [ ] 3.1 Remove operator secrets from the enclave. Verify that `cd enclave && GATEFLOW_CONTRACT=gateflow.testnet cargo test` passes `evm_rpc_defaults` and `contract_is_build_constant`, the existing tests pass, and `GATEFLOW_CONTRACT=gateflow.testnet cargo build --target wasm32-wasip2 --release` succeeds.
  1. In `main.rs`, add `const GATEFLOW_CONTRACT: &str = env!("GATEFLOW_CONTRACT");` and `fn evm_rpc(chain: &str) -> Option<&'static str>` holding the three defaults.
  2. Remove the reads of the `GATEFLOW_CONTRACT` and `EVM_RPC_URLS` secrets.
  3. Commit `refactor(enclave)!: build-time contract, compiled RPCs`.
- [ ] 3.2 Add the Chainalysis provider. Verify that `cd enclave && cargo test` passes `chainalysis_hit_scores_100`, `chainalysis_clean_scores_0`, `chainalysis_unparsable_fails`, `combined_score_takes_max`, `one_identified_sender_fails` and `missing_provider_key_uses_builtin_only`.
  1. In `enclave/src/chainalysis.rs`, add `pub fn score(body: &Value) -> Option<u8>` and `pub fn combined(builtin: Option<u8>, provider: Option<Option<u8>>) -> Option<u8>`.
     - `provider = None` means no key, so the result is `builtin`.
     - `Some(None)` means the lookup failed, so the result is `None`.
     - Otherwise the result is the max of the two.
  2. In `main.rs`, wrap each score closure, for both `Screen` and the three origin branches, so it calls Chainalysis when `secret("CHAINALYSIS_API_KEY")` is set.
  3. Commit `feat(enclave): Chainalysis sanctions provider`.
- [ ] 3.3 Publish the per-network enclave. Verify on testnet that a direct payment from an `0x…` implicit account on a gateway without a profile still settles, and that the `default` profile no longer holds `GATEFLOW_CONTRACT` or `EVM_RPC_URLS`.
  1. Build with `GATEFLOW_CONTRACT=$D`, publish the new OutLayer project version, and remove the two obsolete secrets from the `default` profile.
  2. Update the GOAL.md runbooks: per-network build, the secrets list, and the `OUTLAYER_CONTRACT` env.

## 4. Relay

- [ ] 4.1 Extend the sponsorship allowlist. Verify that `cd relay && node --test src/*.test.ts` passes `set_secrets_allowed`, `store_secrets_allowed`, `store_secrets_other_profile_refused`, `store_secrets_over_deposit_refused`, `delete_secrets_allowed`, `outlayer_other_method_refused`, and that all existing allowlist tests pass.
  1. In `relay/src/delegate.ts`, make `refusal()` receiver-aware per design decision 7. Add env `OUTLAYER_CONTRACT`.
  2. Commit `feat(relay): allow BYOK calls`.
- [ ] 4.2 Add the BYOK routes. Verify that `node --test` passes `prepare_funds_low_balance`, `prepare_skips_funded`, `prepare_once_per_day_429`, `byok_stores_hint_only` (any request body field other than `provider` and `hint` is rejected with 400) and `byok_delete_clears`.
  1. In `relay/src/console.ts`, add `POST /console/byok/prepare`, `PUT /console/byok {provider: "chainalysis", hint}` (where `hint` is exactly 4 characters) and `DELETE /console/byok`.
  2. In `db.ts`, add the merchant columns `byok_provider`, `byok_hint` and `byok_funded_at`.
  3. Commit `feat(relay): BYOK routes`.

## 5. Web

- [ ] 5.1 Seal the key in the browser per the 1.1 findings. Verify that `cd web && npx vitest run src/near` passes `seal_matches_cli_vector`: sealing a fixed secret with a fixed key and nonce reproduces the bytes the OutLayer CLI produced in 1.1.
  1. In `web/src/near/seal.ts`, add `sealSecrets(secrets: Record<string, string>, owner: string, projectId: string): Promise<string>`. It fetches the keystore key directly from OutLayer and returns `encrypted_secrets_base64`, using the cipher recorded in 1.1 through WebCrypto.
  2. Commit `feat(web): seal provider keys for OutLayer`.
- [ ] 5.2 Add the Screening providers tab. Verify on testnet:
  - Connecting a Chainalysis key shows Active with its last 4 characters.
  - `get_gateway` shows `secrets_profile: "gateflow"`.
  - The relay's database and logs contain no full key: `grep -c <key> gateflow.db relay.log` returns 0.
  - Remove returns the tab to Not connected and clears the profile.

  Steps:
  1. In `web/src/console/Settings.tsx`, add the new tab: built-in checks listed as always on, the Chainalysis row, a masked input, and the copy "Encrypted in your browser. Only the screening enclave can read it."
  2. Run the flow from design decision 6.
  3. Commit `feat(web): screening providers settings`.

## 6. Integration and docs

- [ ] 6.1 Run an end-to-end check on testnet. With a valid Chainalysis key connected, pay an invoice from a clean `0x…` implicit account and verify Paid. Replace the key with an invalid one, pay again, and verify Returned (fail closed). Remove the key, pay again, and verify Paid through built-in checks. Delete the secret outside Gateflow while the profile is still set, pay, and verify Returned.
- [ ] 6.2 Document BYOK in `README.md`: what is sealed, who can read it, the project-owner trust note, fail-closed behavior, and the env `OUTLAYER_CONTRACT`. Update the privacy-track notes in `SUMMARY.md` or `GOAL.md` to mark BYOK done. Verify with `grep -n "Chainalysis" README.md`: the BYOK section is present.

## Workflow follow-up

- Archive after `contract-invoices-views` and `web-console-checkout` are archived. The `sponsored-transactions` and `merchant-gateways` MODIFIED deltas need their requirements in the main specs.
