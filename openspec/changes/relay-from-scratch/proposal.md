# Proposal

## Why

Gateflow's backend, `relay/`, is specified in `checkout-relay`, `sponsored-transactions` and `merchant-accounts`, and the README describes it, but the repository has no code for it. Without it, merchants cannot onboard, no 1Click quote is issued, and no one calls `screen_intents`, so `mainnet-launch` (1.3, 2.x) and `console-ai-chat` are blocked. This change writes it from scratch, as `contract-from-scratch` and `enclave-from-scratch` did for their parts.

There is also a contract conflict. `create_gateway` requires at least one execution deposit, but merchants sign it through the sponsorship allowlist, which relays only zero-deposit calls. Their accounts hold only 0.01 NEAR anyway. Onboarding cannot finish.

## What Changes

- **New `relay/`:** one Node 26 process with no npm dependencies. It uses `node:http`, `node:sqlite` and `node:crypto`, and runs TypeScript directly.
  - **Console API:** demo email sessions; account provisioning `<slug>.<operator>`; NEP-366 delegate relaying under the allowlist; gateway, invoice, payment and token data; fuel top-ups; token preferences; retry of failed payments.
  - **Checkout API:**
    - invoice details and the quotable assets;
    - 1Click `EXACT_OUTPUT` quotes with a random `ref`, origins limited to the screenable chains;
    - quote status, and `POST /checkout/screen`.
  - **Watcher:** every 15 s, it submits `screen_intents` from the relay account once a recorded quote reaches `SUCCESS`.
  - **Static serving** of the built `web/` with an SPA fallback. The app itself is a separate change.
- **Contract:** `create_gateway` no longer requires a deposit. It stays payable, and any attached amount becomes fuel. The relay funds the gateway to `FUEL_TARGET` right after creation.
- **`customRecipientMsg` drops `gateway`:** it is `{"invoice","ref","refund_to"}`. The contract and the enclave take the gateway from the invoice.
- **Live checks on testnet:**
  - a dev deployment of the contract that keeps its key, with a placeholder enclave setting;
  - fresh faucet accounts for the contract and the operator;
  - a `dry: true` 1Click quote against mainnet tokens.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `merchant-gateways`: "Create a gateway" is replaced by "Create a gateway with optional fuel", which needs no deposit. An attached deposit still becomes fuel.
- `checkout-relay`: the quote's `customRecipientMsg` no longer carries `gateway`.

## Impact

- **`relay/`:** new code (`main`, `near`, `delegate`, `db`, `console`, `checkout`, `watcher`, `static`) with `node --test` suites that use fakes for NEAR and 1Click.
- **`contract/`:** one `require!` removed from `create_gateway`, with tests updated. The contract has no deployment yet, so nothing needs migrating.
- **Risk accepted for the hackathon:** anyone can create gateways for free, and the contract balance pays their storage (about 0.0015 NEAR each).
- **Testnet:** two new faucet accounts, and a dev contract deployment that keeps its key. This is not the `mainnet-launch` 0.1 rehearsal.
- **Out of scope:**
  - `web/` and the console chat;
  - a live cross-chain payment and the watcher end to end (`mainnet-launch` 2.x);
  - email verification and rate limiting.
