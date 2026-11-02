# Gateflow relay

The Gateflow backend is one Node 26 process with no npm dependencies. It serves the console API, the checkout API, the 1Click screening watcher, and the built `web/` app. TypeScript runs directly; Node strips the types.

## Modules

| File | Role |
|---|---|
| `src/main.ts` | Env config, the `node:http` server, the route table, error mapping and CORS, and the 1Click client. Starts the watcher |
| `src/types.ts` | `Config`, `Deps` (`cfg`, `db`, `near`, `oneclick`, `now`), `Req`/`Res`, `HttpError`, `loadConfig` |
| `src/near.ts` | Hand-written base58 and Borsh, ed25519 signing (`node:crypto`), `TxResult` extraction, and the JSON-RPC client. Every operator send goes through one queue |
| `src/delegate.ts` | Decodes NEP-366 signed delegates and applies the sponsorship allowlist (`refusal`). Also signs delegates, for tests and scripts |
| `src/db.ts` | `node:sqlite` tables: `merchants`, `sessions`, `quotes` |
| `src/console.ts` | `/console/*`: sessions, onboarding, `delegate-params`, `relay`, gateway, invoices, payments, tokens, preferences, retry, fuel top-ups |
| `src/checkout.ts` | `/checkout/*`: invoice, assets, quote, status, screen |
| `src/watcher.ts` | Every 15 s, submits `screen_intents` for recorded quotes that 1Click reports as `SUCCESS` |
| `src/static.ts` | Serves `WEB_DIST`, falling back to `index.html` for the SPA |
| `src/testing.ts` | Fakes for NEAR and 1Click, plus an in-memory DB |

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

The environment variables are listed in the root `README.md`. `PUBLIC_URL` sets the port; the default is `http://localhost:8787`.

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
