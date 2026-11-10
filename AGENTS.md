# AGENTS.md

Gateflow is a non-custodial crypto checkout on NEAR. A contract holds each payment while an OutLayer TEE screens the payer, then settles to the merchant or refunds the payer. [`README.md`](README.md) covers the product, the payment flow and the mainnet status.

## Layout

| Path | Language | Entry point | What it is |
|---|---|---|---|
| `contract/` | Rust, near-sdk 5 | `contract/src/lib.rs` | The `Gateflow` contract: tokens, gateways, invoices, payments, screening callbacks, settle, refund and retry |
| `enclave/` | Rust, `wasm32-wasip2` | `enclave/src/main.rs`, logic in `enclave/src/flows.rs` | The OutLayer guest: `screen` (GoPlus) and `screen_intents` (1Click binding, origin senders on EVM, Solana, Bitcoin and Zcash) |
| `relay/` | TypeScript on Node built-ins | `relay/src/main.ts` | The one backend: serves `web/`, sessions, the console API, the NEP-366 relayer, 1Click quotes, the screening watcher and webhooks |
| `web/` | React, Vite, TypeScript | `web/src/main.tsx` | The landing (`/`), the merchant console (`/console`) and the checkout (`/pay/<id>`) |
| `examples/shop/` | Node built-ins | `examples/shop/server.mjs` | A demo storefront on the merchant API |
| `openspec/` | Markdown | `openspec/specs/` | Specs and change history |

## Commands

```sh
cd contract && cargo test                  # unit tests
cd enclave && cargo test                   # unit tests, network faked with fixtures
cd relay && npm test                       # node:test, fakes in src/testing.ts
cd web && npm ci && npx vitest run && npx tsc --noEmit
node --test examples/shop/server.test.mjs
```

Builds:
- contract: `cargo build --target wasm32-unknown-unknown --release`
- enclave: `GATEFLOW_CONTRACT=<contract> cargo build --target wasm32-wasip2 --release`
- web: `npm run build`

Run a local relay as described in [`relay/README.md`](relay/README.md) (§ Run, § Configuration).

## Workflow

- Work goes through OpenSpec:
  - `openspec/specs/<capability>/spec.md` is the current required behavior.
  - `openspec/changes/<name>/` holds work in flight: `proposal.md`, `design.md`, `tasks.md` and delta specs.
  - `openspec/changes/archive/` is history.
- Commands: `/opsx:explore` (think, no writes), `/opsx:propose <name>` (plan), `/opsx:apply` (implement tasks and tick their checkboxes), `/opsx:archive` (merge the delta specs into `openspec/specs/` and archive). Read `openspec/config.yaml` for the project rules.
- Before changing behavior, read the matching spec. If the behavior changes, the change needs a delta spec.
- Write tests first when a task names one. Run the module's tests before you commit.
- Commits use the Conventional Commits style, short (for example `feat(relay): quote solana origins`). Branch off `main` for work.

## Rules

- `relay/` and `examples/shop/` use Node built-ins only. Add no npm dependencies there.
- The enclave reads no secrets. Its accepted caller and every RPC endpoint are fixed at build (`GATEFLOW_CONTRACT`). Every Gateflow execution must end in `true` or `false`, and any failed lookup gives `false`.
- The relay can delay a payment but never approve one. Keep the enclave's verdict the only path to settlement.
- Never commit `.env`, private keys, API keys or RPC URLs that carry a key. Set secrets in the owner's terminal, not through an agent.
- Never start a local relay with the mainnet `relay/.env` while the Fly app is up: two processes race on the relay key's nonce.
- Ask the owner first for anything on mainnet:
  - contract or enclave deploys (`outlayer deploy`), relay deploys (`fly deploy`)
  - key changes
  - payments
  - pushing, and making the repo public
- Every README claim must be checkable. Update the dated Status and the evidence when mainnet facts change.

## Deploy references

- Relay and web on Fly.io: [`relay/README.md` § Deploy (Fly.io)](relay/README.md#deploy-flyio)
- Enclave on OutLayer, its versions and rollback: [`enclave/README.md`](enclave/README.md)
- Mainnet launch tasks: [`openspec/changes/archive/2026-11-10-mainnet-launch/tasks.md`](openspec/changes/archive/2026-11-10-mainnet-launch/tasks.md)
