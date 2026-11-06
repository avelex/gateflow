# Design

## Context

- The relay (`relay/src/main.ts`) is one Node 26 process with no npm dependencies. It serves `/console/*`, `/checkout/*`, `/api/*` and the built `web/dist` with an SPA fallback (`relay/src/static.ts`). In the same process it runs the 15 s screening watcher (`relay/src/watcher.ts`), webhook delivery with retries (`relay/src/webhooks.ts`, delays 60 s to 12 h) and one nonce-ordered send queue per signing account (`relay/src/near.ts`).
- State is one `node:sqlite` file at `DB_PATH`. Contract state (gateways, invoices, payments) is on chain at `gateflow.near` and needs no migration.
- `loadConfig` derives the listen port from `PUBLIC_URL` (`https:` gives 443) unless `PORT` is set.
- `web/` is a Vite SPA. `VITE_NEAR_NETWORK` and `VITE_SHOP_URL` are baked in at build time. `npm run build` runs `tsc --noEmit`, so the build needs devDependencies.
- Passkeys use `rpId: location.hostname` (`web/src/near/key.ts`), and the merchant's NEAR key is derived from the passkey (PRF).
- Allowed origins and webhook URLs must be `https://` (`relay/src/developers.ts`). A `*.fly.dev` URL qualifies.
- `examples/shop/server.mjs` uses Node built-ins only and reads `GATEFLOW_URL`, `GATEFLOW_KEY`, `GATEFLOW_WEBHOOK_SECRET` and `PORT`.

## Goals / Non-Goals

**Goals:**
- One `fly deploy` from the repo root ships relay and web together. One `fly deploy` from `examples/shop` ships the shop.
- The relay never runs as more than one instance and never sleeps.
- No secret or local database can reach an image.

**Non-Goals:**
- No relay or web source changes. If a task finds that one is needed, it goes in a follow-up change.
- No zero-downtime deploys. A restart of a few seconds is fine, because the watcher works from recorded quotes when it starts again.

## Decisions

1. **Fly.io, not a VPS.** Fly gives `https://<app>.fly.dev` with TLS, a valid passkey RP ID (`fly.dev` is on the Public Suffix List) and daily volume snapshots. A VPS needs a bought domain before TLS or passkeys work, plus OS upkeep. Railway and Render charge extra for persistent disks, and their Node 26 support is uncertain.

2. **One image, single origin.** The root `Dockerfile` has two stages:
   - The `web` stage on `node:26` runs `npm ci && npm run build` with the build args `VITE_NEAR_NETWORK=mainnet` and `VITE_SHOP_URL`.
   - The runtime stage on `node:26-slim` copies `relay/` and `web/dist`, sets `WORKDIR /app/relay` and `WEB_DIST=/app/web/dist`, and runs `CMD ["node", "src/main.ts"]`.

   A split onto a static CDN was rejected: the session cookie is `SameSite=Lax` and same-origin, so a split means CORS and cookie rework, which the proposal excludes.

3. **Exactly one always-on machine.** `fly.toml` sets:
   - `auto_stop_machines = "off"` and `min_machines_running = 1`, so the watcher and webhook loops keep running.
   - one `[mounts]` volume at `/data` and `DB_PATH=/data/gateflow.db`.

   A Fly volume attaches to one machine, so the volume itself blocks accidental scale-out. A second instance would race the relay key's nonce and submit `screen_intents` twice. Region: `fra`.

4. **Explicit `PORT=8080`.** `PUBLIC_URL=https://gateflow.fly.dev` would otherwise make the relay listen on 443. Fly's `internal_port = 8080`, with `force_https = true`.

5. **Health check is `GET /`, with no new route.** `/` returns `index.html` with 200 when `WEB_DIST` is present, and 404 JSON when it is missing. A bad image therefore fails the check, which is the behavior we want.

6. **Config split.**
   - Non-secret values go in `fly.toml` `[env]`:
     - `GATEFLOW_CONTRACT=gateflow.near`
     - `RELAY_ACCOUNT_ID=relay.gateflow.near`
     - `MERCHANT_PARENT=merchant.gateflow.near`
     - `PUBLIC_URL`, `PORT`, `DB_PATH`, `WEB_DIST`, `LLM_MODEL`
     - `OUTLAYER_CONTRACT`, `OUTLAYER_PROJECT`, `OUTLAYER_API`
   - Secrets go through `fly secrets set`: `RELAY_PRIVATE_KEY`, `INVOICE_SIGNER_KEY`, `LLM_API_KEY`, `NEAR_RPC_URL` (a keyed provider URL, so it is not in `fly.toml`) and, if used, `ONECLICK_API_KEY`.
   - Build-time values go in `[build.args]`: `VITE_NEAR_NETWORK`, `VITE_SHOP_URL`.

   The key names match the ones in today's `relay/.env`.

7. **`.dockerignore` at the root** excludes `.env`, `**/.env`, `*.db`, `**/node_modules`, `**/target`, `web/dist`, `.git`, `design/`, `.claude/`, `.superpowers/` and `.impeccable/`. The image builds `web/dist` itself, so a stale local `dist` is never shipped.

8. **The shop is a separate app.** `examples/shop/Dockerfile` (`node:26-slim`, copies `server.mjs` and `index.html`) and `examples/shop/fly.toml` (app `gateflow-shop`, `internal_port = 8080`, auto-stop on, `min_machines_running = 0`, no volume). The build context is `examples/shop`, so nothing from the repo root enters it. It may sleep: the Fly proxy wakes it on a webhook POST, and webhook retries cover a slow cold start.

9. **Fresh database.** The laptop database is not copied. Its only mainnet merchant has a passkey bound to the old host, and everything it settled lives on chain.

## Risks / Trade-offs

- [The passkey hostname is locked to `gateflow.fly.dev`] → Accepted for the hackathon and recorded in the proposal. A custom domain can only be attached before the next real onboarding.
- [The laptop relay and the Fly relay run at the same time with the same relay key] → Nonce races and duplicate `screen_intents`. Mitigation: the first-deploy steps stop the laptop relay before `fly deploy`, and the README says the relay key must run in one place only.
- [The hot key sits on a shared host] → Keep only a few days of gas, storage and fuel on `relay.gateflow.near`, and top it up by hand.
- [Volume host failure or single-region outage] → Restore from the latest volume snapshot (`fly volumes snapshots list`, then `fly volumes create --snapshot-id`). Up to 24 h of SQLite data can be lost (sessions, quotes, webhook config). On-chain funds are unaffected.
- [Deploy restart drops in-flight HTTP requests] → A few seconds of 502s. The watcher and webhook retries resume from the DB.
- [The `node:26` / `node:26-slim` tags, or `node:sqlite` warnings] → The first build verifies the tags. An experimental warning on stderr is harmless.

## Migration Plan

1. Stop the laptop relay. From then on the relay key runs only on Fly.
2. `fly apps create gateflow` and `fly volumes create gateflow_data --region fra --size 1`.
3. `fly secrets set ...` (decision 6), then `fly deploy`. Check `https://gateflow.fly.dev` and `fly logs` for `gateflow relay on :8080 (contract gateflow.near)`.
4. Onboard a merchant on `https://gateflow.fly.dev` and Enable API. Copy the `gf_` key and `whsec_` secret. Set the allowed origin to `https://gateflow-shop.fly.dev` and the webhook URL to `https://gateflow-shop.fly.dev/webhook`.
5. In `examples/shop`: `fly apps create gateflow-shop`, `fly secrets set GATEFLOW_KEY=... GATEFLOW_WEBHOOK_SECRET=...`, then `fly deploy`.

**Rollback:** `fly releases`, then `fly deploy --image <previous image>`. The volume is untouched by a rollback. To fall back fully to the laptop, run `fly scale count 0` first, then start the laptop relay.
