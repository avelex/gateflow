# Web Console and Checkout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. OpenSpec tracks only the `- [ ] N.M` lines; the numbered steps under each task are its TDD cycle and are not tracked separately.

**Goal:** Ship one web app with a merchant console and a public checkout on the real Gateflow contract. Merchants own their accounts through passkeys, and the backend relays their signed delegate actions and pays gas and fuel.

**Architecture:**
- `web/` (Vite, React, TypeScript) ports the two design exports.
- The relay grows into the only backend: `node:sqlite` state, cookie sessions, `/console/*` routes, a NEP-366 relayer with an allowlist, account provisioning, a 1Click watcher, and static serving of `web/dist`.
- Merchant keys are derived in the browser from passkey PRF output and live in WebCrypto. The backend never sees them.

**Tech Stack:**
- `web/`: React 19, Vite, TypeScript, Vitest, `lucide-react`, `@near-js/transactions`, `@near-wallet-selector/*`, `qrcode`.
- `relay/`: Node 26 built-ins only (`node:http`, `node:sqlite`, `node:crypto`), `node --test`.

**Spec:**
- `openspec/changes/web-console-checkout/specs/{merchant-accounts,sponsored-transactions,merchant-console,payer-checkout,checkout-relay}/spec.md`
- `openspec/changes/web-console-checkout/design.md`

## Global Constraints

- Requires the `contract-invoices-views` contract API: `create_gateway(payout_to, policy)`, `create_invoice(gateway, token, amount, expires_in_sec, memo)`, `get_gateway`, `get_invoice`, `get_invoices`, `get_payments`, `get_tokens`.
- **Relay:** no npm dependencies. **Web:** dependencies only from the Tech Stack line.
- **Sponsorship allowlist:**
  - receiver is `GATEFLOW_CONTRACT`;
  - methods are `create_gateway`, `create_invoice`, `set_policy`;
  - deposit is 0 and gas is at most 100 Tgas per action;
  - the sender is the session's `account_id`.
- **Merchant key:**
  - PRF salt is `SHA-256("gateflow/merchant-key/v1")`;
  - the seed is `HKDF-SHA256(prf, salt = empty, info = "ed25519", 32 bytes)`;
  - the recovery phrase format is `ed25519:<base58(seed || publicKey)>`.
- **NEP-366** signing hash: `sha256(u32le(2^30 + 366) || borsh(DelegateAction))`.
- **Provisioning:**
  - the account is `<slug>.<RELAY_ACCOUNT_ID>` with a 0.01 NEAR initial transfer;
  - the default `max_risk` is 50;
  - the onboarding steps are `account → tokens → gateway → done`;
  - `MAX_MERCHANTS` defaults to 100.
- **Fuel:** top up when `fuel < 2 × execution_deposit`, up to `FUEL_TARGET` (default 0.1 NEAR).
- **Cookie:** `gateflow_session`, HttpOnly, SameSite=Lax, Path=/, holding a 32-byte random hex token.
- **Watcher:** runs every 15 s. It stops on `screened`, on 1Click `REFUNDED`/`FAILED`, or once `now > deadline + 1 h`.
- **Polling:** the console every 15 s and on window focus, the checkout every 5 s.
- **UI copy:** no gas, yocto, nonce or tx hash outside a collapsed Details section. Sign-in shows "Demo sign-in: email is not verified." The checkout warning for named accounts reads: "Payments sent from named NEAR accounts (like alice.near) are returned by current screening. Use an Ethereum wallet or pay from another chain."
- **Amounts:** stored as `bigint` raw units and formatted with token decimals. No floats.
- **Commits:** short conventional style, one per task.

## Review Focus

- **Delegate action with one allowed and one disallowed action:** must be refused as a whole (403). Test `mixed_actions_refused` (4.2).
- **The same email onboarding in two tabs at once:** must yield one account. Test `onboard_twice_resumes` (4.3).
- **A business name with no Latin characters ("Кафе Тарту"):** must still produce a valid account id. Test `slug_non_latin_falls_back` (4.3).
- **A payer who requests a quote and never sends:** the watcher must stop polling. Test `watcher_stops_after_deadline` (6.1).
- **Amounts at full precision (24-decimal tokens, 1 raw unit):** must format exactly. Test `format_amount_no_float` (5.3).

---

## 1. Web scaffold and design port

- [x] 1.1 Scaffold `web/` and port the design foundation. Verify that `cd web && npm run build` succeeds, and that `npm run dev` shows the sidebar shell in Schibsted Grotesk with the blue-black-white flag stripe.
  1. Create the Vite React TypeScript app in `web/` with `vite.config.ts` proxying `/console` and `/checkout` to `http://localhost:8787`. Add `vitest`.
  2. Run a one-off script (in the scratchpad, not committed). It reads the `__bundler/manifest` and `__bundler/template` of both export files and writes:
     - the woff2 fonts to `web/src/assets/fonts/` with the same `@font-face` rules;
     - the logo PNGs to `web/src/assets/`;
     - the `:root` token blocks and base rules to `web/src/tokens.css`.
  3. Create `web/src/ui.tsx` with `Button` (variants `primary`, `secondary`, `ghost`, `ink`, `danger`; sizes `sm`/`md`; `icon`; `fullWidth`), `IconButton`, `Icon` (wrapping `lucide-react` by kebab name), `Badge` (tones `success`, `accent`, `warning`, `danger`, `neutral`; `dot`), `Hash` (middle-ellipsis with copy), `Input`, `Select`, `Tabs`, `Switch`, `Stat`, `Toast` and `FlowSteps`. All styling uses the token variables.
  4. Create `web/src/App.tsx` with the pathname switch from design decision 2.
  5. Commit `feat(web): scaffold and design tokens`.

## 2. Merchant key in the browser

- [x] 2.1 Derive the merchant key from a passkey, with a recovery-phrase fallback. Verify that `cd web && npx vitest run src/near` passes `seed_from_prf_deterministic`, `recovery_phrase_roundtrip` and `public_key_matches_seed`. Then manually verify, on Chrome and Safari, that two sign-ins with the same passkey show the same public key.
  1. In `web/src/near/key.ts`, export:
     - `createPasskeyKey(email: string): Promise<MerchantKey>`
     - `getPasskeyKey(): Promise<MerchantKey>`
     - `createFallbackKey(): Promise<{ key: MerchantKey; phrase: string }>`
     - `restoreFallbackKey(phrase: string): Promise<MerchantKey>`
     - `loadStoredKey(): Promise<MerchantKey | null>`
     - where `MerchantKey = { publicKey: Uint8Array; sign(message: Uint8Array): Promise<Uint8Array> }`
     Follow design decision 3. `createPasskeyKey` throws `PrfUnsupported` when the credential's `prf.enabled` is false.
  2. Tests use the pure helpers `seedFromPrf(prf: Uint8Array)` and `pkcs8FromSeed(seed)`, with a fixed 32-byte PRF input and a known-answer seed.
  3. Commit `feat(web): passkey-derived merchant key`.
- [x] 2.2 Build and sign delegate actions. Verify that `npx vitest run src/near` passes `delegate_hash_prefix` (the first 4 bytes before hashing are `6e 01 00 40`) and `signed_delegate_verifies` (WebCrypto `verify` succeeds with the public key).
  1. In `web/src/near/delegate.ts`, export `signDelegate(key: MerchantKey, params: { senderId: string; receiverId: string; nonce: bigint; maxBlockHeight: bigint; actions: { method: string; args: object; gas: bigint }[] }): Promise<string>`, which returns the base64 Borsh `SignedDelegate`. Build it with `@near-js/transactions`.
  2. Write `relay/src/fixtures/signed-delegate.json` from the test (`{ base64, senderId, receiverId, method, args }`) for task 4.2.
  3. Commit `feat(web): sign NEP-366 delegate actions`.

## 3. Backend foundation

- [x] 3.1 Generalize NEAR sending. Verify that `cd relay && node --test src/*.test.ts` passes `actions_borsh_create_account`, `actions_borsh_add_full_access_key`, `actions_borsh_function_call_deposit`, and that the existing tests are unchanged.
  1. In `relay/src/near.ts`, add `export type Action = { createAccount: true } | { transfer: bigint } | { addFullAccessKey: Uint8Array } | { functionCall: { method: string; args: object; gas: bigint; deposit: bigint } } | { signedDelegate: Uint8Array }`, plus:
     - `export function encodeActions(actions: Action[]): Buffer`
     - `export async function sendActions(receiver: string, actions: Action[]): Promise<TxResult>`
     - `export async function view(contract: string, method: string, args: object): Promise<any>`
     - `export async function accountExists(id: string): Promise<boolean>`
     The Borsh enum tags are CreateAccount 0, FunctionCall 2, Transfer 3, AddKey 5 and Delegate 8. `callFunction` becomes a wrapper. Move `viewGateflow` from `main.ts` to `view`.
  2. `TxResult = { hash: string; value?: unknown; error?: string }`, extracted as in design decision 5. Unit-test the extraction on a recorded `send_tx` FINAL response fixture `relay/src/fixtures/tx-panic.json`, asserting `error === "invalid expiry"`.
  3. Commit `refactor(relay): generic NEAR actions`.
- [x] 3.2 Add the database and static serving. Verify that `node --test` passes `db_merchant_roundtrip`, `db_quote_lifecycle`, `static_spa_fallback` (`GET /pay/7` returns `index.html`) and `static_api_404_json` (`GET /console/nope` returns 404 JSON).
  1. Create `relay/src/db.ts` with `openDb(path: string)`. It returns prepared helpers for the three tables in design decision 7. Tests use `":memory:"`.
  2. Create `relay/src/static.ts` with `serveStatic(dir, pathname): { status, type, body } | undefined`. Any non-`/console`/`/checkout` GET without a file falls back to `index.html`.
  3. Wire both into `main.ts`, with env `DB_PATH` (default `gateflow.db`) and `WEB_DIST` (default `../web/dist`).
  4. Commit `feat(relay): sqlite state and static web`.

## 4. Sessions, relayer and provisioning

- [x] 4.1 Add email sessions. Verify that `node --test` passes `session_sets_cookie_flags`, `session_rejects_bad_email` (400), `me_requires_session` (401) and `logout_deletes_session`.
  1. Create `relay/src/console.ts` with these routes:
     - `POST /console/session {email}` returns `{ step }`.
     - `DELETE /console/session`.
     - `GET /console/me` returns `{ email, name, accountId, gatewayId, step }`.
  2. Accept an email that matches `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`, lowercased.
  3. Extend the route signature to receive the request headers and a reply-headers object, so routes can read and set cookies.
  4. Commit `feat(relay): demo email sessions`.
- [x] 4.2 Add the delegate relayer with the allowlist. Verify that `node --test` passes `decode_signed_delegate_fixture`, `allowlist_accepts_create_invoice`, `transfer_refused`, `other_sender_refused`, `deposit_refused`, `gas_cap_refused`, `method_refused`, `mixed_actions_refused`.
  1. In `relay/src/delegate.ts`, export `decodeSignedDelegate(b64: string): DelegateAction` and `refusal(action: DelegateAction, sessionAccount: string, gateflow: string): string | undefined`.
  2. Add the routes:
     - `GET /console/delegate-params` returns `{ nonce, maxBlockHeight, publicKey }` from `view_access_key` and the head block, plus 120 blocks.
     - `POST /console/relay {signedDelegate}`: 403 for any refusal, otherwise `sendActions(sender, [{signedDelegate}])`. A `TxResult.error` becomes 422.
  3. Commit `feat(relay): sponsored delegate actions`.
- [x] 4.3 Add onboarding provisioning. Verify that `node --test` passes `slug_basic` ("Kaja Coffee" gives `kaja-coffee`), `slug_non_latin_falls_back` (gives `merchant`), `slug_trimmed_32`, `onboard_twice_resumes`, `merchant_cap_enforced`. Then verify on testnet that `near account list-keys <slug>.<operator> network-config testnet now` shows exactly one full-access key, the merchant's.
  1. Export `slug(name: string): string` from `console.ts`.
  2. `POST /console/onboard {name, publicKey, payoutTo?}` advances `step`:
     - `account`: the create, transfer and add-key transaction, with a `-N` suffix while `accountExists`.
     - `tokens`: `storage_deposit` on each `get_tokens` token.
  3. When `/console/relay` returns a `create_gateway` result, its `value` sets `gateway_id`, `fund` brings the fuel to `FUEL_TARGET`, and `step` becomes `done`. No separate endpoint is needed.
  4. A second call with a mismatched `publicKey` for an existing account answers 409.
  5. Wrap each step in a per-email in-process lock.
  6. Commit `feat(relay): merchant account provisioning`.
- [x] 4.4 Add console data, fuel top-up and retry. Verify that `node --test` passes `needs_top_up` and `retry_only_failed_own_payment`. Then verify on testnet that draining fuel below two deposits and calling `GET /console/gateway` restores it to `FUEL_TARGET`.
  1. Add the routes:
     - `GET /console/gateway` returns the gateway with `fuelReady`, after a top-up when `needsTopUp(fuel, deposit)` is true.
     - `GET /console/invoices` and `GET /console/payments` page through every entry using the counts, newest first, with token metadata.
     - `GET /console/tokens` returns the allowlist, metadata and the merchant's on/off state.
     - `PUT /console/preferences {tokensOff}`.
     - `POST /console/retry {payment}`, refused unless the payment's gateway is the merchant's and its status is `*Failed`.
  2. Commit `feat(relay): console data, fuel and retry`.

## 5. Console UI

- [x] 5.1 Add sign-in and onboarding screens. Verify manually on testnet that a new email completes these steps:
  - email
  - passkey (or the recovery phrase on a PRF-less authenticator)
  - business name and optional payout account
  - passkey confirm for `create_gateway`

  It must land on Home. A reload must resume where it left off, and sign-out must show the signed-out card from the design.
  1. In `web/src/console/Onboarding.tsx`: the `signDelegate` call goes to `create_gateway(payout_to, {max_risk: 50})` with 30 Tgas.
  2. Commit `feat(web): sign-in and onboarding`.
- [x] 5.2 Add the layout, Home and Search. Verify that `npx vitest run src/console` passes `settled_today_totals`. Also verify manually that Cmd/Ctrl+K opens Search and that Escape closes it.
  1. In `web/src/console/Layout.tsx`: a collapsible sidebar, a Screening count badge, and a profile menu with Settings and Sign out.
  2. In `Home.tsx`: the greeting, `settledToday(payments, now)` per token, and the disabled composer with "Assistant coming soon".
  3. In `Search.tsx`: client-side matching over the loaded invoices and payments.
  4. Commit `feat(web): console layout, home, search`.
- [x] 5.3 Add the Invoices screen. Verify that `npx vitest run src/console` passes `invoice_tab_expired`, `format_amount_no_float` (`formatAmount(1n, 24)` gives `"0.000000000000000000000001"`; `formatAmount(1000000n, 6)` gives `"1"`) and `parse_amount_exact`. Then verify on testnet that creating a 1 USDC invoice shows it Open with a copyable `/pay/<id>` link.
  1. In `web/src/format.ts`, add `formatAmount(raw: bigint, decimals: number): string` and `parseAmount(text: string, decimals: number): bigint` (throwing on too many decimals).
  2. In `Invoices.tsx`, add `invoiceTab(inv, nowSec)`, the tabs All, Open, Paying, Paid, Returned and Expired, and a create form (token from enabled tokens, amount, expiry 3600/86400/604800, memo of at most 140 bytes). Creating calls `signDelegate` and then `/console/relay`.
  3. Commit `feat(web): invoices`.
- [x] 5.4 Add the Screening and Settings screens. Verify that `npx vitest run src/console` passes `screening_tabs`. Then verify on testnet that changing risk tolerance to 20 makes `get_gateway` show `max_risk: 20`, and that switching ZEC off removes it from the invoice form.
  1. In `Screening.tsx`: the Pending, Refunded and Failed tabs with counts, and Retry for Failed.
  2. In `Settings.tsx`, the modal with two tabs:
     - Gateway: payout account, fuel shown as Ready or Topping up, and a risk slider from 0 to 80 that relays `set_policy`.
     - Tokens & chains: the toggles call `PUT /console/preferences`, and the origins list is read-only.
  3. Commit `feat(web): screening and settings`.

## 6. Checkout

- [x] 6.1 Add the checkout backend: invoice details, assets, quote recording and the watcher. Verify that `node --test` passes `checkout_invoice_404`, `assets_screenable_only`, `watcher_screens_on_success`, `watcher_already_started_counts_as_screened`, `watcher_stops_on_refunded` and `watcher_stops_after_deadline`.
  1. Add `GET /checkout/invoice?id=`. It joins `get_invoice`, the merchant name from the database (looked up by `gateway_id`), the payment status and `refund_to` when present, and token metadata.
  2. Add `GET /checkout/assets`.
  3. `POST /checkout/quote` inserts a `quotes` row.
  4. `GET /checkout/status` adds `screening`.
  5. In `relay/src/watcher.ts`, export `tick(ports: { quotes, oneClickStatus, paymentByRef, screen }, nowMs)`, tested with fakes. Start it with `setInterval(tick, 15000)` in `main.ts`.
  6. Commit `feat(relay): checkout details and screening watcher`.
- [x] 6.2 Add the checkout page and timeline. Verify that `npx vitest run src/checkout` passes `timeline_direct_pending`, `timeline_cross_chain_detected`, `timeline_paid`, `timeline_returned` and `unpayable_states`. Then verify manually that `/pay/999999` shows "Invoice not found".
  1. In `web/src/checkout/Checkout.tsx`, use the two-column design layout. Add `timeline(invoice, payment, quoteStatus)`, which returns the 4 steps with their done and current state, and `unpayable(invoice, nowSec)`, which returns "paid", "returned", "expired" or `undefined`.
  2. Commit `feat(web): checkout page and timeline`.
- [x] 6.3 Add the NEAR wallet payment. Verify on testnet:
  - Choosing the NEAR wallet option shows the named-account warning first.
  - A payment from a named testnet account turns the timeline to "Returned to you".
  - With `VITE_REOWN_PROJECT_ID` set, a payment from an Ethereum wallet's `0x…` account reaches "Released to merchant".

  Steps:
  1. In `web/src/checkout/wallet.ts`, set up wallet-selector with `my-near-wallet`, `meteor-wallet` and `here-wallet`, and `ethereum-wallets` only when the env var is set.
  2. `payDirect(invoice)` calls `ft_transfer_call({receiver_id: GATEFLOW_CONTRACT, amount, msg: JSON.stringify({gateway, invoice})})` with 1 yocto and 300 Tgas (100 Tgas ran out of gas on testnet: `ft_on_transfer` forwards 100 Tgas to OutLayer plus a 40 Tgas callback).
  3. Commit `feat(web): pay with NEAR wallet`.
- [x] 6.4 Add payment from another chain. Verify that `npx vitest run src/checkout` passes `quote_form_requires_both_refunds`, and verify manually against a fixture-backed relay (`ONECLICK_URL` pointed at a stub) that the deposit address, QR code, amount and countdown render.
  1. The form has: an asset picker from `/checkout/assets`, an origin refund address, and a NEAR refund account validated with the relay's `NEAR_ACCOUNT` regex, copied into `web/src/format.ts`.
  2. `POST /checkout/quote`, then render with `qrcode` and poll `/checkout/status`.
  3. Make `ONECLICK_URL` env-configurable in `relay/src/main.ts`, defaulting to the current constant.
  4. Commit `feat(web): pay from another chain`.

## 7. Integration and docs

- [x] 7.1 Run an end-to-end check on testnet: onboard a new merchant, create a 1 USDC invoice, pay it from a named testnet account, and verify that the console shows the invoice Returned and the payment under Screening → Refunded, and that the checkout shows "Returned to you". If `VITE_REOWN_PROJECT_ID` is available, repeat with an Ethereum wallet and verify Paid and Released.
- [x] 7.2 Update the docs. Update `README.md` (run `web/` and the relay, the env vars `PUBLIC_URL`, `DB_PATH`, `FUEL_TARGET`, `WEB_DIST`, `MAX_MERCHANTS`, `VITE_REOWN_PROJECT_ID`, and the payment flow from the merchant's side). Also replace the stale Purpose in `openspec/specs/checkout-relay/spec.md` (Sumsub, "keeps no state") with text for the checkout API and the stateful backend. Verify that `grep -n "Sumsub\|keeps no state" README.md openspec/specs/checkout-relay/spec.md` returns nothing, and that the README run commands work from a clean clone.

## Workflow follow-up

- Deferred from 6.3 (agreed): the `ethereum-wallets` module behind `VITE_REOWN_PROJECT_ID`, and the check that an `0x` payer reaches "Released to merchant". This needs a Reown project ID and the enclave project registered on OutLayer, since today every testnet payment is refunded with "Project not found".
- Archive after `contract-invoices-views` has been archived, and after the `screen-cross-chain-payer` specs have been synced, because the `checkout-relay` deltas stack on both.
