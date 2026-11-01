# Proposal

## Why

The console design's Settings has a "Bring your own keys" section: merchants screen with providers they already pay for. In Gateflow the screening happens inside the OutLayer TEE (secure enclave), so a merchant's provider key can be sealed to that enclave and used only there. Gateflow, the operator and the relay never see it.

This is the privacy-track pitch: "your compliance keys never leave the enclave". Today every gateway shares one operator-owned OutLayer secrets profile, so a per-merchant key has nowhere to live.

## What Changes

- **Spike first.** Confirm the OutLayer programmatic path: the keystore public-key request, `store_secrets` arguments, the deposit, access-condition JSON, and whether plaintext ever reaches the coordinator. Also confirm the Chainalysis Sanctions API request and response shape. If storing requires sending the plaintext key to anyone but the TEE, the change stops at the spike.
- **Contract:**
  - The owner-only `set_secrets(gateway, profile?)` stores a secrets profile name on the gateway.
  - Screening executions pass `secrets_ref {profile, account_id: gateway.owner}` when the gateway has a profile, and the global `default` otherwise.
  - The account is always the gateway owner, so one merchant can never spend another merchant's key.
- **Enclave without operator secrets:**
  - `GATEFLOW_CONTRACT` becomes a build-time constant.
  - The EVM RPC URLs become compiled public defaults.
  - Only provider keys (`CHAINALYSIS_API_KEY`) and the optional `ONECLICK_API_KEY` are read from secrets, so a merchant profile alone runs a full screening.
- **Chainalysis Sanctions provider.** When `CHAINALYSIS_API_KEY` is present, every screened address (the direct payer, or the origin senders) is also checked against Chainalysis. An identified address scores 100. A failed lookup fails the screening closed. The built-in GoPlus and OFAC checks still run.
- **Console "Screening providers" tab.**
  - The merchant pastes a Chainalysis key. The browser encrypts it for the OutLayer keystore and sends it with a passkey-signed `store_secrets`, then signs `set_secrets`.
  - The operator first sends the merchant account the 0.1 NEAR storage deposit, which OutLayer refunds on delete.
  - The tab shows the provider as Active with the last 4 characters.
  - Remove signs `set_secrets(None)` and `delete_secrets`.
- **Sponsorship allowlist** gains `set_secrets` on Gateflow, and `store_secrets` and `delete_secrets` on the OutLayer contract, with a deposit of at most 0.1 NEAR.

## Capabilities

### New Capabilities
- `screening-providers`: merchant-owned provider keys sealed to the enclave, how the enclave uses them, and their removal.

### Modified Capabilities
- `merchant-gateways`: adds the owner-only screening secrets profile, and the lookup returns it.
- `payment-clearing`: screening executions use the gateway's secrets reference.
- `sponsored-transactions`: the allowlist covers the BYOK calls and their deposit.
- `merchant-console`: adds the Screening providers settings.

## Impact

- **Contract:** `Gateway.secrets_profile`, `set_secrets`, and `execute` taking the gateway. Changing the state layout needs a fresh deploy.
- **Enclave:** removes the `GATEFLOW_CONTRACT` and `EVM_RPC_URLS` secrets, adds a Chainalysis client, and builds per network.
- **Relay and web:** an allowlist update, a BYOK pre-funding route, and a Settings tab.
- **Order:** builds on `contract-invoices-views`, `web-console-checkout` and `screen-cross-chain-payer`, and archives after them.
