# Fly Deploy Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the mainnet relay and web app at `https://gateflow.fly.dev` and the demo shop at `https://gateflow-shop.fly.dev`.

**Architecture:** A multi-stage root image builds `web/` and runs the relay, and the relay serves both the API and `web/dist`. It runs on one always-on Fly machine with a volume at `/data`. The shop is a separate small Fly app built from `examples/shop`. See `design.md` for the rationale.

**Tech Stack:** Docker, Fly.io (`flyctl`), Node 26, Vite.

**Spec:** `openspec/changes/fly-deploy/design.md`. The change has no delta specs (`skip_specs: true`).

## Global Constraints

- No source changes in `relay/src`, `web/src` or `examples/shop/server.mjs`. If one turns out to be needed, stop and raise it.
- Base images: `node:26` for the build stage, `node:26-slim` for runtime.
- Relay app `gateflow`, region `fra`, `internal_port = 8080`, `PORT=8080`, `PUBLIC_URL=https://gateflow.fly.dev`, `DB_PATH=/data/gateflow.db`, `WEB_DIST=/app/web/dist`, `auto_stop_machines = "off"`, `min_machines_running = 1`.
- Relay env: `GATEFLOW_CONTRACT=gateflow.near`, `RELAY_ACCOUNT_ID=relay.gateflow.near`, `MERCHANT_PARENT=merchant.gateflow.near`, `NEAR_RPC_URL=https://rpc.mainnet.fastnear.com`. The `OUTLAYER_*` and `LLM_MODEL` values are copied from the names in `relay/.env`.
- Build args: `VITE_NEAR_NETWORK=mainnet`, `VITE_SHOP_URL=https://gateflow-shop.fly.dev`.
- Secrets go only through `fly secrets`: `RELAY_PRIVATE_KEY`, `INVOICE_SIGNER_KEY`, `LLM_API_KEY` and `ONECLICK_API_KEY` if set. Never print a secret value in a terminal transcript. Pipe it, for example `grep -E '^(RELAY_PRIVATE_KEY|INVOICE_SIGNER_KEY|LLM_API_KEY)=' relay/.env | fly secrets import --stage`.
- The relay key runs in one place only. Stop the laptop relay before the first Fly deploy.
- Shop app `gateflow-shop`, region `fra`, `internal_port = 8080`, auto-stop on, `min_machines_running = 0`, no volume.

## Review Focus

- The laptop relay is still running when Fly starts. Expect a refusal to proceed, not nonce races. Task 2.1 checks for a local `node src/main.ts` process first.
- The machine goes idle and stops, which silently kills the watcher. Expect it to keep running. Task 2.1 checks `fly machine status` after 10 idle minutes.
- `.env` or `*.db` leaks into the image. Expect neither in any layer. Task 1.1 runs `find` inside the image.
- `PORT` is missing, so the relay binds 443 and the health check fails. Expect the log line `gateflow relay on :8080`. Tasks 1.1 and 2.1.
- The bundle is still built for testnet. Expect `mainnet` and the shop URL in the bundle. Task 1.1 greps `web/dist/assets`.

---

## 1. Relay image and config

- [x] 1.1 Add `.dockerignore` (design decision 7) and the root `Dockerfile` (decision 2, with `ARG VITE_NEAR_NETWORK` and `ARG VITE_SHOP_URL` passed into the web build). Verify all of these:
  - `docker build --build-arg VITE_NEAR_NETWORK=mainnet --build-arg VITE_SHOP_URL=https://gateflow-shop.fly.dev -t gateflow .` succeeds.
  - `docker run --rm gateflow sh -c 'find / \( -name ".env" -o -name "*.db" \) -not -path "/proc/*" 2>/dev/null'` prints nothing.
  - `docker run --rm gateflow sh -c 'grep -l gateflow-shop.fly.dev /app/web/dist/assets/*.js && grep -l mainnet /app/web/dist/assets/*.js'` finds both.
  - `docker run --rm -p 8080:8080 -e GATEFLOW_CONTRACT=gateflow.near -e PORT=8080 -e PUBLIC_URL=http://localhost:8080 -e DB_PATH=/tmp/g.db gateflow` logs `gateflow relay on :8080 (contract gateflow.near)`, and `curl -sf localhost:8080/ | grep -q '<div id="root"'` passes.
  - Commit `build: add relay docker image`.
- [x] 1.2 Add the root `fly.toml` with every value from Global Constraints (app, region, `[build.args]`, `[env]`, `[mounts] source = "gateflow_data"` at `/data`, `[http_service]` with `force_https = true`, the auto-stop settings, and a `[[http_service.checks]]` `GET /`). Verify `fly config validate` passes and `grep -c auto_stop_machines fly.toml` is 1. Commit `build: add fly config for relay`.

## 2. Relay on Fly

- [ ] 2.1 First deploy (design Migration Plan 1–3). Steps:
  - Check that `pgrep -fl "node src/main.ts"` shows no local relay. Stop it if it runs.
  - `fly apps create gateflow`, then `fly volumes create gateflow_data --region fra --size 1`.
  - Import the secrets as Global Constraints shows, then `fly deploy`.

  Verify all of these:
  - `fly logs` shows `gateflow relay on :8080 (contract gateflow.near)`.
  - `curl -sI https://gateflow.fly.dev/` returns 200.
  - `fly machines list` shows exactly one machine.
  - After 10 idle minutes, `fly machine status <id>` still says `started`.
  - After `fly machine restart <id>`, `fly ssh console -C "ls -l /data"` still lists `gateflow.db`.
- [x] 2.2 Merchant and API setup on the new host (design Migration Plan 4).
  - Onboard one merchant with a passkey at `https://gateflow.fly.dev`, then Enable API.
  - Set Allowed origins to `https://gateflow-shop.fly.dev` and the webhook URL to `https://gateflow-shop.fly.dev/webhook`.
  - Keep the `gf_` key and the `whsec_` secret out of the repo.

  Verify `near contract call-function as-read-only gateflow.near get_gateway json-args '{"id":<n>}' network-config mainnet now` shows the new merchant as `owner`, and the console's Developers page lists the origin and webhook. Record the merchant account and gateway id under `mainnet-launch` task 1.3.
- [x] 2.3 Add a "Deploy (Fly.io)" section to `relay/README.md` and link it from the root `README.md` Run section. The section covers:
  - the app and volume commands and the secrets import line
  - "the relay key runs in one place only"
  - the snapshot restore (`fly volumes snapshots list`, `fly volumes create --snapshot-id`)
  - rollback (`fly releases`, `fly deploy --image`)
  - the passkey hostname lock

  Verify every command in the section matches `fly.toml` names (`gateflow`, `gateflow_data`, `fra`). Commit `docs: fly deploy runbook`.

## 3. Shop on Fly

- [x] 3.1 Add `examples/shop/Dockerfile` (`node:26-slim`, copies `server.mjs` and `index.html`, `CMD ["node", "server.mjs"]`) and `examples/shop/fly.toml` (shop values from Global Constraints, `[env] GATEFLOW_URL = "https://gateflow.fly.dev"`, `PORT = "8080"`). Verify that `node --test examples/shop/server.test.mjs` passes, that `docker build -t gateflow-shop examples/shop` succeeds, and that `cd examples/shop && fly config validate` passes. Commit `build: add fly config for demo shop`.
- [x] 3.2 Deploy the shop. In `examples/shop`, run `fly apps create gateflow-shop`, then `fly secrets set` for `GATEFLOW_KEY` and `GATEFLOW_WEBHOOK_SECRET` from 2.2 (typed by the owner, not echoed into the transcript), then `fly deploy`. Verify that `curl -sf https://gateflow-shop.fly.dev/` returns the shop page and that the landing page's shop link at `https://gateflow.fly.dev` opens it. Add the shop deploy commands to the `relay/README.md` section from 2.3 and to the `examples/shop` paragraph in the root `README.md`. Commit `docs: shop deploy`.

## Workflow follow-up

- The paid end-to-end checks (Base USDC, BTC, ZEC, and the shop webhook flow) are `mainnet-launch` tasks 2.1–2.4, run against these URLs. Update `mainnet-launch` task 1.3 and the 2.4 wording (no tunnel) when 2.2 lands.
- Run `/opsx:archive fly-deploy` after review.
