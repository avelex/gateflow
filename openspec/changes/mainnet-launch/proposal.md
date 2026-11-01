# Proposal

## Why

Gateflow runs end to end on testnet, but no part of it has run on mainnet: the contract is not deployed, the enclave is not registered, and no live USDC, BTC or ZEC payment has cleared. These checks were the last open tasks of `screen-cross-chain-payer`. That change is archived with its code done, so the launch is tracked here against the current model: one gateway per merchant that accepts every token on the operator's allowlist.

## What Changes

- Deploy a fresh mainnet Gateflow contract and allowlist USDC, nBTC (`nbtc.bridge.near`) and ZEC (`zec.omft.near`).
- Register the OutLayer enclave with its mainnet secrets and run the relay against mainnet.
- Onboard one merchant through the console. That merchant's gateway receives the live payments.
- Clear one live payment per origin: USDC from Base, native BTC, and transparent ZEC.
- Run one negative check: a deposit address from another quote must refund, never settle.
- Record the transaction hashes and the 1Click `SUCCESS` fixture as evidence.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. This change only verifies behavior that the current specs already define. The change sets `skip_specs: true`.

## Impact

- **Operations:** a mainnet contract account, an operator (relay) account funded for storage, gas and fuel, and an OutLayer enclave registration with secrets.
- **Repository:** `enclave/tests/fixtures/oneclick-status-success.json`, and transaction hashes in `GOAL.md`.
- **Cost:** real funds for the test payments (1 USDC, 0.0001 nBTC, a small ZEC amount) and for 1Click fees.
- **Out of scope:** BYOK screening keys (`byok-screening-keys`), the console assistant (`console-ai-chat`), and an Ethereum-wallet payer option.
