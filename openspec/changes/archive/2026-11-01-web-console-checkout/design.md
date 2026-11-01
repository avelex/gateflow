# Design

## Context

Motivation and scope: see proposal.md. Requirements: the specs in this change.

**Current state:**
- **Relay** (`relay/src/main.ts`): one `node:http` server with a `routes` table, `HttpError` mapping and permissive CORS. It has no npm dependencies and runs on Node 26 with TypeScript type stripping.
- **NEAR signing** (`relay/src/near.ts`): hand-rolled Borsh. `keyPair()` reads near-cli `ed25519:` secrets, and `callFunction()` sends one FunctionCall from `RELAY_ACCOUNT_ID`.
- **No frontend exists.**
- **Design exports:** the two files are design-tool bundles. A JSON `__bundler/manifest` holds base64 assets (Schibsted Grotesk and IBM Plex Mono woff2, logo PNGs). The `__bundler/template` holds the markup, `:root` token CSS and a logic class.
  - The UI components (`Button`, `IconButton`, `Badge`, `Hash`, `Input`, `Select`, `Tabs`, `Switch`, `Checkbox`, `Stat`, `Toast`, `FlowSteps`) live in a proprietary runtime script.
  - Icons are Lucide names.

**Contract after `contract-invoices-views`:**
- Writes: `create_gateway(payout_to, policy)`, `create_invoice`, `set_policy`, `fund`, `retry`.
- Views: `get_gateway` (with counts), `get_invoice`, `get_invoices`, `get_payments`, `get_tokens`.

## Goals / Non-Goals

**Goals:**
- One deployable process: the relay serves the API and the built web app from one origin.
- The merchant never sees a wallet, a seed phrase, NEAR or gas. The operator can never sign as the merchant.
- Reuse the relay's hand-rolled NEAR code rather than adding a NEAR SDK to the backend.

**Non-Goals:**
- Email verification, multiple users per merchant, rate limiting beyond a merchant cap.
- The chat assistant (`console-ai-chat`), BYOK (`byok-screening-keys`), withdrawing to other chains, and fiat invoices.
- Refunding cross-chain payers on their origin chain. The contract refunds to a NEAR account, so checkout asks for one.

## Decisions

**1. Layout.**
- `web/` is a Vite React TypeScript app. Its source:
  - `src/ui.tsx`: all ported components in one file.
  - `src/tokens.css`: verbatim from the export.
  - `src/assets/`: extracted fonts and logos.
  - `src/console/`: the console screens.
  - `src/checkout/`: the checkout page.
  - `src/near/`: the merchant key and delegate actions.
  - `src/api.ts`.
- `relay/src/` gains:
  - `db.ts` (`node:sqlite`)
  - `console.ts` (routes)
  - `delegate.ts` (decode and check a signed delegate action)
  - `watcher.ts`
  - `static.ts` (serves `WEB_DIST` with an SPA fallback)
  - `near.ts` is generalized to `sendActions(receiver, actions)` with CreateAccount, Transfer, AddKey (FullAccess), FunctionCall and SignedDelegate.
- *Alternative:* a separate console service. That means two deploys and two holders of the operator key.

**2. No router library.**
- `App` switches on `location.pathname`: `/pay/:id` goes to Checkout, and `/`, `/invoices` and `/screening` go to the console.
- Settings and Search are modals, as in the design.
- Navigation is `history.pushState` plus a `popstate` listener. That is about 15 lines for four routes.

**3. Merchant key in WebCrypto.**
- **PRF mode:**
  1. `navigator.credentials.create`/`get` with `extensions.prf.eval.first = SHA-256("gateflow/merchant-key/v1")`.
  2. `HKDF-SHA256(prf, info "ed25519")` gives a 32-byte seed.
  3. The seed is wrapped in the same PKCS#8 prefix as `relay/src/near.ts`, imported once as extractable to read the public key `x` through `exportKey("jwk")`, and re-imported non-extractable for signing.
  4. The key is derived again on each sign-in and never stored.
- **Fallback mode:**
  1. `generateKey("Ed25519", true)` creates a key.
  2. It is exported once as a near-cli `ed25519:<base58 seed||pk>` string. This string is the recovery phrase, and it can be imported into any NEAR wallet.
  3. The key is re-imported non-extractable and stored as a `CryptoKey` in IndexedDB.
- *Alternatives:* `@noble/ed25519` keeps key bytes in JS memory, and an MPC or embedded wallet is custodial or a vendor dependency.

**4. Delegate actions.**
- The browser builds a `DelegateAction` with `@near-js/transactions` (`buildDelegateAction`, `encodeDelegateAction`, `encodeSignedDelegate`) and signs `sha256(prefix NEP-366 || borsh)`.
- Parameters come from `GET /console/delegate-params`: `nonce` (access key nonce + 1), `maxBlockHeight` (head + 120) and the expected public key.
- The backend decodes the signed delegate itself in `delegate.ts` (Borsh reader, about 80 lines) to apply the sponsorship allowlist. It submits through `sendActions(sender, [SignedDelegate])`, signed by the operator.
- The chain verifies the signature and the access key. The backend only enforces sender, receiver, methods, deposit and gas.

**5. Relayed results.**
- `send_tx` uses `wait_until: "FINAL"`. The backend scans `receipts_outcome` for the receipt executed by `GATEFLOW_CONTRACT`:
  - `SuccessValue`: base64-decoded and JSON-parsed. This gives the invoice id and the gateway id.
  - A `FunctionCallError.ExecutionError` message: becomes a 422 with the panic text, with the "Smart contract panicked: " prefix removed.

**6. Provisioning.**
- **Account:** one operator transaction to `<slug>.<RELAY_ACCOUNT_ID>` with `CreateAccount`, `Transfer` of 0.01 NEAR (storage for the key) and `AddKey(merchantPk, FullAccess)`.
  - The slug is the name lowercased, with non-`[a-z0-9]` runs turned into `-`, trimmed to 32 characters.
  - If `view_account` finds the account, the backend tries `-2`, `-3` and so on.
- **Token storage:** the operator calls `storage_deposit({account_id, registration_only: true})` on each allowlisted token, attaching that token's `storage_balance_bounds.min`.
- **Gateway:** the merchant's `create_gateway` goes through the relayer. The operator then calls `fund` up to `FUEL_TARGET`.
- The onboarding step is stored per merchant (`account` → `tokens` → `gateway` → `done`) so it can resume.
- The default `max_risk` is 50.

**7. Database and sessions.**
- One SQLite file (`DB_PATH`) with three tables:
  - `merchants(email PK, name, account_id, public_key, gateway_id, step, tokens_off JSON)`
  - `sessions(token PK, email, created_at)`
  - `quotes(ref PK, invoice, deposit_address, deadline, status, screened INTEGER)`
- There is no ORM. Queries are prepared statements in `db.ts`.
- `MAX_MERCHANTS` (default 100) caps onboarding, because each account costs the operator about 0.02 NEAR.

**8. Watcher.**
- `setInterval` every 15 seconds in the same process, over quotes where `screened = 0` and the deadline plus one hour has not passed.
- It calls 1Click `/status`. On `SUCCESS` it calls `get_payment_by_ref` and then `screen_intents`.
- "screening already started" counts as screened, so the watcher is idempotent with the existing `POST /checkout/screen`.

**9. Data loading.**
- The app uses plain `fetch` and polls: the console every 15 seconds and on window focus, the checkout every 5 seconds.
- Token metadata (`ft_metadata`) is cached in memory by the backend and returned with lists.
- The console computes Expired from `expires_at_sec`, and computes "today" totals from payments whose `opened_at_sec` is today and whose status is Settled.

**10. Checkout wallets.**
- `@near-wallet-selector/core` and `modal-ui` with the `my-near-wallet`, `meteor-wallet` and `here-wallet` modules.
- `ethereum-wallets` is added only when `VITE_REOWN_PROJECT_ID` is set, because it pulls in wagmi and Reown. It is the only payer path that settles under current screening.

## Risks / Trade-offs

- **Unverified email gives read access to any merchant's data.** → The console labels sign-in as demo-only. Writes still need the passkey. Real verification is deferred.
- **Account spam drains the operator.** → `MAX_MERCHANTS`, one account per email.
- **PRF is unavailable on some authenticators, or WebCrypto Ed25519 is missing on old browsers.** → The recovery-phrase fallback covers the first. Task 1.1 checks the second on Chrome, Safari and Firefox before any UI is built.
- **Payments from named NEAR accounts are always refunded.** → The checkout warns before payment. The `ethereum-wallets` module covers the testnet demo.
- **1Click is mainnet only.** → The cross-chain checkout UI is built and unit-tested against fixtures, and the end-to-end check moves to mainnet together with `screen-cross-chain-payer` group 6.
- **The export markup uses a proprietary component runtime.** → The components are re-implemented from their visible props. Their exact look is checked side by side against the export screenshots, not pixel-tested.

## Migration Plan

1. Deploy `contract-invoices-views` first. This change reads its views.
2. Set the new env vars (`PUBLIC_URL`, `DB_PATH`, `FUEL_TARGET`, `WEB_DIST`, `MAX_MERCHANTS`). Run `npm run build` in `web/`, then start the relay.
3. Rollback: stop the process. On-chain state is unaffected, and the SQLite file can be deleted for a demo reset.
