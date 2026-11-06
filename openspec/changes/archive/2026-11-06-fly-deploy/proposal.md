# Proposal

## Why

The mainnet relay and web app run only on a developer laptop (`relay/.env`, `DB_PATH=gateflow-namespace.db`), so the watcher stops when the laptop sleeps and there is no public URL for merchants, payers or the landing page's demo shop. `mainnet-launch` task 1.3 needs the relay running against mainnet on a public origin, and task 2.4 needs a public shop with a webhook endpoint.

## What Changes

- Add a root `Dockerfile` that builds `web/` for mainnet and runs the relay on Node 26, serving `web/dist` from the same origin.
- Add a root `fly.toml` for the Fly app `gateflow` (`https://gateflow.fly.dev`): one always-on machine in `fra`, a volume for the SQLite file, and non-secret env. Secrets go through `fly secrets`.
- Add a `.dockerignore` so `.env`, `*.db`, `node_modules` and Rust `target/` never enter the image.
- Add `examples/shop/Dockerfile` and `examples/shop/fly.toml` for a second Fly app, `gateflow-shop` (`https://gateflow-shop.fly.dev`), which the landing page links to through `VITE_SHOP_URL`.
- Document the deploy, the first-boot order (relay, then merchant onboarding and Enable API, then shop secrets) and the backup story in `relay/README.md`.
- Start mainnet on a fresh database. The laptop database is not migrated.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. This change adds deployment tooling only; no requirement in the current specs changes. The change sets `skip_specs: true`.

## Impact

- **Repository:** new `Dockerfile`, `.dockerignore`, `fly.toml`, `examples/shop/Dockerfile`, `examples/shop/fly.toml`; a deploy section in `relay/README.md`. No relay or web source changes.
- **Operations:** a Fly.io account with two apps and one 1 GB volume. Fly volume snapshots (daily, kept 5 days) are the only backup.
- **Passkeys:** the passkey RP ID is `location.hostname`, so `gateflow.fly.dev` becomes the permanent merchant hostname. Moving to another domain later means every merchant re-onboards. The merchant onboarded on the laptop (`zqwc2wda.merchant.gateflow.near`) cannot sign on the new host.
- **Secrets:** `RELAY_PRIVATE_KEY` (full access on `merchant.gateflow.near`), `INVOICE_SIGNER_KEY`, `LLM_API_KEY` and `ONECLICK_API_KEY` live in Fly secrets on one machine. The relay account keeps a small NEAR float to limit loss on compromise.
- **Unblocks:** `mainnet-launch` tasks 1.3 and 2.1–2.4 run against public URLs; 2.4 no longer needs a tunnel.
- **Out of scope:** CI deploys, custom domains, multi-instance or multi-region, monitoring beyond Fly logs and an optional uptime ping.
