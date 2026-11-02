# Proposal

## Why

The contract asks an OutLayer enclave for every screening verdict, but this repository has no `enclave/` code, even though the README, the `payment-clearing` spec and `mainnet-launch` depend on it. Without the guest, no payment can settle. This change writes it from scratch against the existing spec, the same way `contract-from-scratch` wrote the contract.

## What Changes

- **New `enclave/` crate:** a Rust `wasm32-wasip2` OutLayer guest. It reads the contract's request JSON from stdin and writes exactly `true`, `false` or `null` to stdout.
  - `screen` (direct payments): the NEAR payer passes only if it is an implicit EVM account that GoPlus rates at or below `max_risk`.
  - `screen_intents` (1Click payments): checks the 1Click binding (status `SUCCESS`, recipient, invoice, `ref`, amount), resolves the origin-chain senders (EVM RPC, Blockstream Esplora, Blockchair), and screens every sender (GoPlus for EVM, the OFAC lists for BTC and ZEC).
- **The enclave reads no secrets.**
  - The allowed caller (`GATEFLOW_CONTRACT`) and the public EVM RPC map are fixed at build time, with one wasm per network.
  - 1Click `/v0/status` is called anonymously. The optional API key stays in the relay, where it only lowers the quote fee.
- **Never panic on external data.** A panic makes the OutLayer execution fail, and the contract then credits the execution deposit back to the gateway's fuel from its own balance. Every lookup error therefore outputs `false`, which spends the fuel.
- **Explicit GoPlus weights.** The spec's "highest weighted GoPlus flag" gets a published weight table.
- **Testnet spike first.** It confirms the guest's output bytes, `NEAR_PREDECESSOR_ID`, HTTP under `wasm32-wasip2`, and an execution with no stored secrets profile.
- **Sync docs:** the README Status section, and `mainnet-launch` task 1.2, which still lists enclave secrets.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `payment-clearing`: three added requirements and no changed ones.
  - The GoPlus risk score: the weight table behind "highest weighted GoPlus flag", used by both paths.
  - The enclave reads no secrets: the caller and the RPCs are fixed at build time.
  - Every Gateflow execution ends in a `true` or `false` verdict, never in a failed execution.

## Impact

- **`enclave/`:** new crate (`serde`, `serde_json`, `wasi-http-client`), unit tests on JSON fixtures, and a release wasm per network.
- **OutLayer:** a project `<operator>/gateflow` on testnet, plus a placeholder `default` secrets profile only if the spike shows that a missing profile fails executions.
- **Contract:** no code change. The request shapes in `contract/src/payments.rs` and `contract/src/screening.rs` are the interface. The testnet contract gets `set_enclave` pointed at the new project.
- **`mainnet-launch`:** task 1.2 is rewritten to build, upload and deploy the mainnet wasm instead of storing secrets.
- **Out of scope:** `relay/`, `web/` and `GOAL.md` (separate changes), BYOK provider keys (`byok-screening-keys`), screening of real NEAR accounts, and live payments (`mainnet-launch`).
