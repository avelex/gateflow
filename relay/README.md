# Gateflow relay

The Gateflow backend is one Node 26 process with no npm dependencies. It serves the console API, the checkout API, the 1Click screening watcher, and the built `web/` app. TypeScript runs directly; Node strips the types.

## Modules

| File | Role |
|---|---|
| `src/main.ts` | Env config, the `node:http` server, the route table, error mapping and CORS, and the 1Click client. Starts the watcher, and builds the model client when `LLM_API_KEY` is set |
| `src/types.ts` | `Config`, `Deps` (`cfg`, `db`, `near`, `oneclick`, `llm?`, `now`), `Req`/`Res`, `HttpError`, `loadConfig` |
| `src/near.ts` | Hand-written base58 and Borsh, ed25519 signing (`node:crypto`), `TxResult` extraction, and the JSON-RPC client. Every operator send goes through one queue |
| `src/delegate.ts` | Decodes NEP-366 signed delegates (with function-call args) and applies the sponsorship allowlist (`refusal`). Also signs delegates, for tests and scripts |
| `src/db.ts` | `node:sqlite` tables: `merchants`, `sessions`, `quotes`, `chat_threads`, `chat_messages`, `chat_actions` |
| `src/console.ts` | `/console/*`: sessions, onboarding, `delegate-params`, `relay` (binds an `actionId` to its confirmed assistant action), gateway, invoices, payments, tokens, preferences, retry, fuel top-ups |
| `src/chat.ts` | The console assistant: OpenAI-compatible model client, read tools, propose-only write tools, the bounded tool loop, `/console/chat`, threads and action confirm / dismiss |
| `src/checkout.ts` | `/checkout/*`: invoice, assets, quote, status, screen |
| `src/watcher.ts` | Every 15 s, submits `screen_intents` for recorded quotes that 1Click reports as `SUCCESS` |
| `src/static.ts` | Serves `WEB_DIST`, falling back to `index.html` for the SPA |
| `src/testing.ts` | Fakes for NEAR, 1Click and the model, plus an in-memory DB |

## Test

```sh
cd relay && npm test                      # unit tests, no network
LIVE=1 node --test src/live.test.ts       # dry 1Click quote against the live API
```

## Run

```sh
cd relay
GATEFLOW_CONTRACT=<contract> RELAY_ACCOUNT_ID=<operator> RELAY_PRIVATE_KEY=ed25519:<secret> npm start
```

`PUBLIC_URL` sets the port; the default is `http://localhost:8787`. `node --env-file=.env src/main.ts` reads the same variables from `relay/.env`.

For UI work, run `npm run dev` in `web/` (port 5173). It proxies `/console` and `/checkout` to the relay on 8787, except browser navigations to `/console/*`, which load the app.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `GATEFLOW_CONTRACT` | (required) | Gateflow contract account |
| `RELAY_ACCOUNT_ID`, `RELAY_PRIVATE_KEY` | (required for writes) | Relay account: relays merchants' signed delegate actions, pays gas, storage and fuel |
| `MERCHANT_PARENT` | `RELAY_ACCOUNT_ID` | Account that creates merchant accounts `<label>.<MERCHANT_PARENT>` (8 random `a-z2-7` characters); the relay key must be a full-access key on it |
| `PUBLIC_URL` | `http://localhost:8787` | Public origin; `https:` turns on `Secure` session cookies |
| `DB_PATH` | `gateflow.db` | SQLite file with merchants, sessions, quotes and screening txs; delete it to reset a demo |
| `WEB_DIST` | `../web/dist` | Built web app to serve |
| `FUEL_TARGET` | `100000000000000000000000` (0.1 NEAR) | Gateway fuel after a top-up; a top-up runs when fuel drops below two execution deposits |
| `EXECUTION_DEPOSIT` | `10000000000000000000000` (0.01 NEAR) | Must match the contract's `execution_deposit` |
| `MAX_MERCHANTS` | `100` | Onboarding cap; each merchant costs the operator about 0.02 NEAR |
| `NEAR_RPC_URL` | `https://rpc.testnet.fastnear.com` | NEAR RPC |
| `ONECLICK_URL`, `ONECLICK_API_KEY`, `EVM_CHAINS` | 1Click v0, none, `base,eth,arb` | NEAR Intents 1Click endpoint, optional key, and the EVM origins the enclave can screen |
| `OUTLAYER_CONTRACT`, `OUTLAYER_PROJECT` | `outlayer.near`, `ops.gateflow.near/gateflow` | OutLayer contract and project whose active wasm hash the checkout shows; use `outlayer.testnet` and the testnet project on testnet |
| `OUTLAYER_API` | `https://api.outlayer.ai` | OutLayer coordinator API, used to find each screening's job for its attestation link; `https://testnet-api.outlayer.ai` on testnet |
| `LLM_BASE_URL` | `https://cloud-api.near.ai/v1` | OpenAI-compatible chat completions endpoint for the console assistant |
| `LLM_API_KEY` | none | Key for that endpoint. Without it, chat answers 503 and the composer shows "Assistant not configured" |
| `LLM_MODEL` | none | Model id with tool calling, from `GET <LLM_BASE_URL>/model/list`. Tested: `z-ai/glm-5.3-flash` (runs in a TEE, operated by NEAR AI) |
| `CHAT_DAILY_LIMIT` | `200` | Assistant messages per merchant per UTC day; beyond it chat answers 429 |
| `INVOICE_SIGNER_KEY` | none | `ed25519:` secret of the invoice signer key that merchants add with Enable API. Without it the merchant API is off |
| `VITE_NEAR_NETWORK` (web build) | `testnet` | Network for the checkout's NEAR wallets |
| `VITE_REOWN_PROJECT_ID` (web build) | none | Reserved for the Ethereum-wallet payer option, which is not wired yet (out of scope in `openspec/changes/web-from-scratch/proposal.md`) |

## Deploy (Fly.io)

Mainnet runs at `https://gateflow.fly.dev` (Fly app `gateflow`, region `fra`). The root `Dockerfile` builds `web/` for mainnet and runs the relay, which serves both. `fly.toml` holds the non-secret config. The relay key runs in one place only. Never start a local relay with the mainnet `relay/.env` while the Fly app is up: two processes race on the key's nonce and submit `screen_intents` twice.

First deploy, from the repo root:

```sh
fly apps create gateflow
fly volumes create gateflow_data --region fra --size 1 -a gateflow
grep -E '^(RELAY_PRIVATE_KEY|INVOICE_SIGNER_KEY|LLM_API_KEY|ONECLICK_API_KEY)=' relay/.env | fly secrets import --stage -a gateflow
fly secrets set --stage -a gateflow NEAR_RPC_URL=<mainnet RPC URL with its key>
fly deploy --ha=false
```

`NEAR_RPC_URL` is a secret, not a `fly.toml` value, because the provider URL carries an API key. Stage it before any deploy. Without it the relay falls back to the testnet RPC, and every call against `gateflow.near` fails. Set secrets in your own terminal, not through an agent session, so their values stay out of transcripts.

Later deploys are only `fly deploy`. Keep exactly one machine: the volume attaches to one, and the watcher, webhook delivery and the SQLite file at `/data/gateflow.db` all assume a single process. `auto_stop_machines = "off"` keeps the watcher running when nobody has the site open.

- **Logs:** `fly logs -a gateflow`. A healthy start prints `gateflow relay on :8080 (contract gateflow.near)`.
- **Backups:** Fly takes daily volume snapshots and keeps them 5 days. To restore, run `fly volumes snapshots list <volume id>` (the id comes from `fly volumes list -a gateflow`), then `fly volumes create gateflow_data --snapshot-id <id> --region fra -a gateflow`. Then destroy the old volume and machine, and run `fly deploy`. A restore loses at most a day of SQLite data (sessions, quotes, webhook settings). On-chain state is unaffected.
- **Rollback:** `fly releases -a gateflow --image`, then `fly deploy --image <previous image>`.
- **Moving back to a laptop:** run `fly scale count 0 -a gateflow` first, then start the local relay.
- **Hostname lock:** passkeys use `location.hostname` as RP ID, so merchants onboarded on `gateflow.fly.dev` can only sign there. A custom domain later means every merchant onboards again.

### Demo shop

The landing page links to `https://gateflow-shop.fly.dev` (build arg `VITE_SHOP_URL`). Deploy it from `examples/shop` after a merchant on `gateflow.fly.dev` has enabled the API. Set that merchant's allowed origin to `https://gateflow-shop.fly.dev` and its webhook URL to `https://gateflow-shop.fly.dev/webhook`, then run:

```sh
cd examples/shop
fly apps create gateflow-shop
fly secrets set --stage -a gateflow-shop GATEFLOW_KEY=gf_... GATEFLOW_WEBHOOK_SECRET=whsec_...
fly deploy --ha=false
```

The shop keeps no state, so it may stop when idle. The first request wakes it, and webhook retries cover the cold start.

## Testnet dev deployment (relay-from-scratch 5.1, 2026-11-02)

- **Accounts:**
  - operator, relay and `intents`: `gateflow-op-v1.testnet`
  - contract: `gateflow-dev-v1.testnet`, with its full-access key kept. It is a dev deployment, not the `mainnet-launch` rehearsal.
  - Both were created with `near account create-account sponsor-by-faucet-service`, and their keys are in the macOS keychain.
- **Contract:**
  - `new(op, op, op, {outlayer: "outlayer.testnet", project: "gateflow-op-v1.testnet/gateflow-placeholder", secrets_owner: op}, 0.01 NEAR)`: tx `EeXjRt8AbQ2QuLfHKsTVBydp4cPgAHMwLRbe3TQATq9A`
  - The enclave is a placeholder, so every screening on this deployment fails and refunds.
- **Token:**
  - `add_token("wrap.testnet")`: `8RJXXSuT5cH7hHJVQp1YRduySVvFf9hyghtWBQPXGiwk`
  - `storage_deposit` of the contract on `wrap.testnet`: `2UnPaqJQKw1cm98mwsiUTXrT6PfdhVqZLqjxq4Zuk8Hu`
- **Merchant run:**
  - command: `RELAY_URL=http://localhost:8811 GATEFLOW_CONTRACT=gateflow-dev-v1.testnet NAME="Kaja Coffee" node scripts/merchant.ts`
  - account `kaja-coffee.gateflow-op-v1.testnet`. Its only access key is the merchant's (full access).
  - relayed `create_gateway` gave gateway 0: `GioeZXZ3U1t4UCMESN8fWC81SrC6bQYJ5mpFcnTPzEjp`. The relay then funded it to 0.1 NEAR.
  - relayed `create_invoice` gave invoice 0, for 1 wNEAR: `5YfPddR7FLBxR2DS4K99GBgASS9rDyDzCKLVJ7Fkzm4n`. Gateway fuel then read 0.09831 NEAR, because the invoice's storage is drawn from fuel.
  - a delegate containing a Transfer was refused with 403 "only function calls are sponsored".
  - `/checkout/invoice?id=0` showed `Open` with "Kaja Coffee". `/checkout/assets` listed BTC and no Solana asset.
- **Live dry quote:** 1 USDC on NEAR from Base USDC costs `amountIn` 1.010309 USDC.

## Mainnet Solana check (screen-solana-payer 4.4, 2026-11-09)

- **Deploy:** enclave version `bceb9c0b…` activated on `ops.gateflow.near/gateflow`, then the relay deployed on Fly.io. After that, `/checkout/assets` lists Solana assets.
- **Payment:** invoice 46 (0.02 USDC, gateway 2, from the demo shop), paid with USDC on Solana.
  - Solana sender: `CKPp4HE2KXm1nnyYa6auHgTgZe8YszCMrZpUh2J6FJP2`
  - Solana tx: `2MGSRAMJmwZYsfpkLU84oro5ycUwK2MjRBAPFQTMY4f7g4ZHFThX2TuqHs46YYcdQCbsKgmjZHXFmJZJ63ZsXMiP`
- **Result:** payment 12 `Settled`, invoice `Paid`. Screening `approved` in 1.5 s by OutLayer job `1326858` (request `2877`, NEAR tx `Bt38fMnAKAcZ2rGd7nnwzxtaeba662BvqEhq4QBquKya`), with wasm hash `bceb9c0bc12a0a8e8c81b1e419c9b43ebe58511d4f2b8089b1195fa80a18e27a`.
  - Attestation: `https://app.outlayer.ai/attestation/1326858?network=mainnet`
- **Timing:** the deposit was seen 11 s before the payment opened on NEAR, and the payment was screened and closed 14 s after that.
