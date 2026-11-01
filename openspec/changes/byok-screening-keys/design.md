# Design

## Context

Motivation: see proposal.md. Requirements: the specs in this change.

**Contract today:** `execute()` (`contract/src/lib.rs`) sends every OutLayer request with `secrets_ref {profile: "default", account_id: secrets_owner}`.

**Enclave today** (`enclave/src/main.rs`):
- `run()` exits with null unless `NEAR_PREDECESSOR_ID == GATEFLOW_CONTRACT`, and both values are read from env.
- EVM origin senders are resolved through the `EVM_RPC_URLS` secret.
- Scores: `GoPlus.risk_score` for EVM addresses, `origin::ofac_score` for BTC and ZEC, combined per sender by `origin::all_pass(senders, score, max_risk)`. Any `None` fails closed.

**OutLayer facts** (docs and `outlayer-cli` 0.1.0 source):
- Secrets are keyed by accessor + profile + owner. Accessor forms are `{"Project": {"project_id"}}`, `{"WasmHash": {"hash"}}` and `{"Repo": …}`.
- `store_secrets {accessor, profile, encrypted_secrets_base64, access}` costs a 0.1 NEAR deposit, which is refunded on delete.
- Access conditions include `"AllowAll"` and `{"Whitelist": [...]}`. The docs also describe a `Predecessor` wrapper and a CLI `--via`, but not their JSON.
- **Encryption, inconsistent:** the docs describe ECIES, while the CLI fetches a "pubkey" with a request that includes `secrets_json`, then uses ChaCha20-Poly1305 with that value as the key.
- **Not documented:** the keystore endpoint, its CORS policy, and whether the coordinator sees plaintext.

**Merchant setup** (from `web-console-checkout`): the merchant account is `<slug>.<operator>`. It is funded with 0.01 NEAR, and writes are passkey-signed delegate actions relayed under an allowlist.

## Goals / Non-Goals

**Goals:**
- A merchant's provider key is readable only inside the enclave, usable only for that merchant's gateway, and never seen by the Gateflow backend.
- A gateway without BYOK is screened exactly as today.

**Non-Goals:**
- Providers other than the Chainalysis Sanctions API (paid KYT, TRM, Elliptic), a generic provider plugin system, per-provider risk weights.
- Checking the key against Chainalysis before saving it.
- Verifying enclave attestation in the console.

## Decisions

**1. Spike first, with a stop condition.**
- Task 1.1 settles the exact OutLayer storing path. It records the keystore endpoint, its request body, the cipher, browser CORS, and the access JSON in this decision, so later tasks build on facts.
- **Stop condition:** if any request in the path carries the plaintext key to a party other than the TEE (including OutLayer's coordinator), and CLI and docs offer no TEE-only alternative, the change stops after group 1. The proposal and specs are then revised.

**2. Secrets reference pinned to the gateway owner.**
- `Gateway.secrets_profile: Option<String>` is set by the owner-only `set_secrets`, validated against `^[a-z0-9_-]{1,32}$`.
- `execute()` takes the gateway, and builds `secrets_ref` as `{profile, account_id: gateway.owner}` when a profile is set and `{"default", secrets_owner}` otherwise.
- The owner cannot be chosen, so no gateway can point at another merchant's secrets. This closes the quota-abuse hole found during explore.
- The profile is read when the screening executes, not when the payment opens. A merchant who removes their key mid-flight gets built-in screening.

**3. The enclave no longer needs operator secrets.**
- `GATEFLOW_CONTRACT` becomes `env!("GATEFLOW_CONTRACT")` at build time, with one wasm per network.
- EVM RPCs become a compiled map: `base` → `https://base-rpc.publicnode.com`, `eth` → `https://ethereum-rpc.publicnode.com`, `arb` → `https://arbitrum-one-rpc.publicnode.com`.
- Only `CHAINALYSIS_API_KEY` and the optional `ONECLICK_API_KEY` are read from env.
- **Why:** an execution carries one `secrets_ref`, and merging the merchant's and the operator's secrets is unconfirmed for project runs. A merchant profile must therefore be enough on its own.
- **Side effect:** a merchant profile can set only those two names, so it cannot redirect RPCs or the contract check. At worst it sets `NEAR_PREDECESSOR_ID`, if worker variables can be overridden (checked in 1.1), and that only affects executions the merchant runs directly, whose output no contract accepts.

**4. Access condition and binding.**
- The accessor is `{"Project": {"project_id": <gateflow enclave project>}}`, the profile is `gateflow`, and the owner is the merchant account.
- Access is set to the narrowest condition that admits executions requested by the Gateflow contract, as found in 1.1 (`Predecessor`/`--via`).
- If no such condition exists, access is `"AllowAll"`. This is acceptable because the project binding limits decryption to the Gateflow enclave, and the enclave outputs null for any caller but the Gateflow contract before touching providers. Direct runs with a merchant profile therefore cannot spend that merchant's key.

**5. Chainalysis client.**
- `GET https://public.chainalysis.com/api/v1/address/{address}` with header `X-API-Key`. The shape `{"identifications": [...]}` is to be confirmed in 1.2.
- A non-empty list scores 100 and an empty one scores 0. Any failure gives `None`, which fails closed.
- The score per address is `max(builtin, chainalysis)` when a key is present, and `builtin` otherwise. Built-in `None` still fails closed, so named NEAR payers stay refunded.
- **Placement:** `enclave/src/chainalysis.rs`, with `score(body) -> Option<u8>` pure and tested on fixtures.

**6. Console flow.** The key never touches Gateflow servers.
- **Adding a key:**
  1. `POST /console/byok/prepare` makes the operator transfer 0.1 NEAR when the balance is low, at most once per day.
  2. The browser seals the key per 1.1, talking to OutLayer directly.
  3. The browser signs `store_secrets` (0.1 NEAR deposit) and sends it through the relayer.
  4. The browser signs `set_secrets(gateway, "gateflow")` and sends it through the relayer.
  5. `PUT /console/byok {provider, hint}` stores only the last 4 characters.
- **Removing a key:** the browser signs `set_secrets(gateway, None)` first, so no screening references a deleted secret, then `delete_secrets`, then `DELETE /console/byok`.
- The merchant key is already derived for the session, so signing several delegates needs no extra prompts beyond what the key module requires.

**7. Allowlist.** `refusal()` in `relay/src/delegate.ts` gains receiver-specific rules:
- Gateflow: zero deposit, methods now including `set_secrets`.
- `OUTLAYER_CONTRACT` (env: `outlayer.testnet` or `outlayer.near`): `store_secrets` and `delete_secrets` only, deposit at most 0.1 NEAR, and args `profile === "gateflow"`.

## Risks / Trade-offs

- **The OutLayer storing path exposes plaintext, or blocks browsers.** → The stop condition in decision 1. A backend proxy is allowed only for requests without plaintext.
- **The project owner (the Gateflow operator) can publish an enclave version that leaks keys.** → This is inherent in project binding. Mitigations: publish the enclave code hash (privacy-track option 2), and optionally offer "One build only" later, which makes merchants re-seal on every upgrade.
- **An invalid or rate-limited Chainalysis key refunds every payment, because it fails closed.** → The Screening tab makes the refunds visible, and the Providers tab shows which key is active. Checking the key first is a non-goal for now.
- **Free Chainalysis API limits and terms.** → One request per screened address. BTC deposits with many inputs can make many requests. Accepted for v1.
- **Builds per network.** → `GATEFLOW_CONTRACT` is fixed in each wasm, so testnet and mainnet need separate builds and OutLayer project versions. This is documented in the GOAL runbook.

## Migration Plan

1. Run the group 1 spikes, and proceed only if decision 1 holds.
2. Deploy the contract fresh (the `Gateway` layout changes), together with or after `contract-invoices-views`.
3. Build the enclave with `GATEFLOW_CONTRACT=<account>` for each network and publish a new OutLayer project version. Remove `GATEFLOW_CONTRACT` and `EVM_RPC_URLS` from the `default` profile.
4. Deploy the relay and web with `OUTLAYER_CONTRACT` set.
5. **Rollback:** merchants clear their profile, or the operator redeploys the previous enclave version. Gateways without a profile are unaffected.
