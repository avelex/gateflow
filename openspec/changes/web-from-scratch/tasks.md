# Web From Scratch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. OpenSpec tracks only the `- [ ] N.M` lines; the numbered steps under each task are its TDD cycle and are not tracked separately.

**Goal:** Write `web/`, Gateflow's merchant console and public checkout, on the relay that already exists. Also make `/checkout/invoice` return the contract account.

**Architecture:**
- A Vite React app with no router, no store and no NEAR SDK in the console.
- Every rule with a branch is a pure function in a `logic.ts`, `format.ts` or `near/*.ts` file, tested by Vitest in Node.
- Merchant keys live in WebCrypto: derived from passkey PRF, or a stored recovery-phrase key. Delegates are hand-encoded and cross-checked byte for byte against the relay's encoder.

**Tech Stack:** `react` and `react-dom` 18.3.1 and `lucide` 0.469.0 (the exports' versions, pinned exactly), Vite, TypeScript, Vitest, `qrcode`, `@near-wallet-selector/{core,modal-ui,my-near-wallet,meteor-wallet,here-wallet}`. The relay stays on Node 26 built-ins with `node --test`.

**Design source:** `design/Gateflow Console.html` and `design/Gateflow Checkout.html`. Every screen is translated from them under design decision 13. Decoded copies of each template and script go in the scratchpad during 2.3, so later tasks can read the markup.

**Spec:**
- `openspec/specs/merchant-console/spec.md`, `openspec/specs/payer-checkout/spec.md` and `openspec/specs/merchant-accounts/spec.md` (the browser requirements).
- `openspec/changes/web-from-scratch/specs/` (the deltas).
- `openspec/changes/web-from-scratch/design.md`.

## Global Constraints

- `web/package.json`: `"private": true`, `"type": "module"`, with scripts `dev` (`vite`), `build` (`tsc --noEmit && vite build`) and `test` (`vitest run`).
- Dependencies come only from the Tech Stack line, with versions pinned by `package-lock.json`. Vitest uses `environment: "node"`.
- `vite.config.ts` proxies `/console` and `/checkout` to `http://localhost:8787`. The build output is `web/dist`.
- The only env var is `VITE_NEAR_NETWORK`, default `testnet`. The contract account comes from `/checkout/invoice`, and links use `location.origin`.
- **Key:**
  - the PRF salt is `SHA-256("gateflow/merchant-key/v1")`;
  - the seed is `HKDF-SHA256(prf, salt = empty, info = "ed25519", 32 bytes)`;
  - the PKCS#8 prefix is `302e020100300506032b657004220420`;
  - the phrase is `ed25519:<base58(seed || publicKey)>`;
  - `localStorage["gateflow:keyMode"]` is `"prf"` or `"stored"`;
  - the IndexedDB store is `gateflow` / `keys` / `merchant`.
- **NEP-366:** the signing hash is `sha256(u32le(2^30 + 366) || borsh(DelegateAction))`. The deposit is `0` and the gas is `30000000000000` per action.
- **Methods:**
  - `create_gateway({payout_to, policy: {max_risk: 50}})`;
  - `create_invoice({gateway, token, amount, expires_in_sec, memo?})`, with `expires_in_sec` one of `3600`, `86400` or `604800`, and `memo` at most 140 UTF-8 bytes;
  - `set_policy({gateway, policy: {max_risk}})`, with `max_risk` from 0 to 80 in steps of 5.
- **Direct payment:** `ft_transfer_call({receiver_id: <contract>, amount, msg: JSON.stringify({invoice: <id>})})` on the invoice token, with deposit `1` yocto and gas `300000000000000`.
- **Polling:** the console every `15000` ms and on window focus, and the checkout every `5000` ms.
- **Copy:**
  - "Demo sign-in: email is not verified."
  - "Assistant coming soon"
  - "Invoice not found"
  - "This invoice has expired"
  - "Payments sent from named NEAR accounts (like alice.near) are returned by current screening. Pay from another chain to avoid this."
  - "You can close this page. Your payment continues."
  - "This passkey does not own this account"
  - "This browser can't hold a merchant key"
- **Design:**
  - UI is built only from `ds.jsx` components and the exports' markup and inline styles;
  - no colour, font, size, spacing, radius or shadow value comes from anywhere other than `tokens.css`, the exports' inline styles or `ds.jsx`;
  - copy is the exports' copy, except for the replacements in design decision 13 and the copy lines below.
- **Fidelity check** (named "screenshot check" in tasks):
  - Playwright takes screenshots of the app screen and of the export, navigated to the same screen through its own UI, at 1440×900 and 390×844, saved to the scratchpad;
  - layout, type, colour and spacing match side by side;
  - only data and decision 13's replacements differ.
- No gas, yocto, nonce or tx hash appears outside a collapsed Details section.
- Amounts are `bigint` raw units or decimal strings, never JS numbers.
- `localStorage`, `sessionStorage` and IndexedDB access is wrapped in try/catch. The page works without them, except for a fallback key.
- Commits: short conventional style, one per task.

## Review Focus

- An amount with too many decimals, `0`, `1e3` or `-1` must be refused before signing, not rounded. Test `parse_amount_rejects` (2.2).
- A passkey that derives a key other than the account's must sign nothing and send nothing. Test `owner_mismatch_throws` (3.2).
- An invoice whose expiry is exactly now must count as expired on both pages. Tests `unpayable_at_expiry_boundary` (5.1) and `invoice_tab_expired` (4.3).
- A 1Click swap that refunds on the origin chain before delivery must not leave the timeline stuck on "Deposit detected". Test `timeline_origin_refund` (5.1).
- A corrupt or blocked saved quote must not break the checkout page. Test `saved_quote_bad_storage` (5.3).

---

## 1. Relay

- [x] 1.1 Return the contract account from `/checkout/invoice` (design decision 12). Verify that `cd relay && npm test` passes `checkout_invoice_contract`
  **Files:** `relay/src/checkout.ts`, `relay/src/checkout.test.ts`.
  1. Test `checkout_invoice_contract`: with `fakeDeps` and `cfg.gateflow` set to `gateflow.near`, the response's `json.contract === "gateflow.near"`.
  2. Run: FAIL. 3. Add `contract: deps.cfg.gateflow` to the `invoice` handler's reply. 4. Run: PASS. 5. Commit `feat(relay): contract account in checkout invoice`.

## 2. Scaffold

- [x] 2.1 Scaffold `web/`, routing and the API client. Verify that `cd web && npm ci && npm test && npm run build` passes `route_of` and writes `web/dist/index.html`, and that the relay started with `WEB_DIST=../web/dist` serves it at `/pay/0`
  **Files:** `web/package.json`, `web/package-lock.json`, `web/index.html`, `web/vite.config.ts`, `web/tsconfig.json`, `web/.gitignore` (`node_modules`, `dist`), `web/src/main.tsx`, `web/src/App.tsx`, `web/src/api.ts`, `web/src/App.test.ts`, `web/README.md`.
  **Produces:**
  - `type Route = {page: "checkout"; invoice: number} | {page: "console"; tab: "home" | "invoices" | "screening"} | {page: "redirect"}`
  - `route(pathname: string): Route`
  - `navigate(path: string): void`
  - `api<T>(method: "GET" | "POST" | "PUT" | "DELETE", path: string, body?: object): Promise<T>`, which sends `credentials: "same-origin"` and JSON
  - `class ApiError extends Error { status: number }`, built from `{error}`
  1. Test `route_of`:
     - `/pay/7` gives `{page: "checkout", invoice: 7}`;
     - `/` gives home, `/invoices` gives invoices, `/screening` gives screening;
     - `/pay/x` and `/nope` give redirect.
  2. FAIL. 3. Implement. `App` renders placeholders for now. 4. PASS. 5. In `web/README.md`, document `npm run dev`, `npm test`, `npm run build`, `VITE_NEAR_NETWORK`, and that passkey keys are bound to the hostname (design, Risks). 6. Commit `feat(web): scaffold, routing and api client`.
- [x] 2.2 Amounts and account ids (design decision 11). Verify that `npm test` passes the tests below
  **Files:** `web/src/format.ts`, `web/src/format.test.ts`.
  **Produces:**
  - `formatAmount(raw: bigint, decimals: number): string`
  - `parseAmount(text: string, decimals: number): bigint`
  - `isNearAccount(s: string): boolean`
  - `timeLeft(sec: number): string`, giving `"1h 05m"`, `"4m 09s"` or `"0s"`
  1. Tests:
     - `format_amount_no_float`: `formatAmount(1n, 24)` gives `"0.000000000000000000000001"`, `formatAmount(1000000n, 6)` gives `"1"`, and `formatAmount(10000000n, 8)` gives `"0.1"`.
     - `parse_amount_exact`: `parseAmount("0.01", 8)` gives `1000000n`, and `parseAmount("1", 24)` gives `10n ** 24n`.
     - `parse_amount_rejects`: `"0.0000001"` at 6 decimals, `"0"`, `"1e3"`, `"-1"`, `""` and `"1,5"` all throw.
     - `near_account_ids`: `alice.near`, `kaja-coffee.gateflow-op-v1.testnet` and a 64-hex implicit id pass; `Alice.near`, `a`, `bad..near` and a 65-character id fail.
     - `time_left_format`.
  2. FAIL. 3. Implement with string math only. Copy the relay's `NEAR_ACCOUNT` regex and its 2–64 bounds. 4. PASS. 5. Commit `feat(web): amount formatting`.
- [ ] 2.3 Take the design system from the exports (design decision 13). Verify that `npm test` passes `ds_exports_all` and `icon_renders_lucide`, that `npm run build` passes, and that the dev-only gallery at `/?ui` passes the screenshot check against the components as they appear in both exports
  **Files:** `web/src/tokens.css`, `web/src/ds.jsx`, `web/src/ds.d.ts`, `web/src/screens.css` (empty for now), `web/src/assets/**`, `web/src/assets.ts`, `web/src/Gallery.tsx`, `web/src/ds.test.ts`. `tsconfig.json` sets `allowJs`.
  **Produces:**
  - `ds.jsx` exports `Button`, `Icon`, `IconButton`, `Badge`, `Card`, `Hash`, `Stat`, `StatusBadge`, `Tag`, `Dialog`, `Toast`, `Tooltip`, `FlowSteps`, `Checkbox`, `Input`, `Radio`, `Select`, `Switch` and `Tabs`. Their props are exactly the bundle's, and `ds.d.ts` types them from the bundle's destructuring.
  - `assets.ts` exports `logo`, `logoMark`, `chainIcon(chain: string): string | undefined` and `tokenIcon(symbol: string): string | undefined`.
    - `chainIcon` maps `eth` to `chain-ethereum`, `btc` to `chain-bitcoin` and `zec` to `chain-zcash`.
    - `tokenIcon` maps `USDC` to `chain-usdc`, `nBTC` and `BTC` to `chain-bitcoin`, and `ZEC` to `chain-zcash`.
    - Anything else gives `undefined`, and the screen renders no icon. No icons are drawn that the exports do not have.
  1. In the scratchpad, write and run the extraction script. It gunzips `compressed` entries; writes the fonts, logos and `ext`-named images once each; copies every template `<style>` block verbatim into `tokens.css` with the `url()`s rewritten; and saves the decoded templates and the design-system bundle in the scratchpad.
  2. Tests:
     - `ds_exports_all`: each of the 19 names is a function.
     - `icon_renders_lucide`: `renderToStaticMarkup(<Icon name="wallet"/>)` contains `<path` and `viewBox="0 0 24 24"`.
  3. FAIL. 4. Create `ds.jsx` from the bundle with only the edits decision 13 lists. 5. PASS. 6. The gallery renders every component with the props the exports' markup passes it, grep-ed from the decoded templates. 7. Commit `feat(web): design system from the exports`.

## 3. Merchant key

- [ ] 3.1 Borsh and delegate signing (design decision 5). Verify that `npm test` passes the tests below
  **Files:** `web/src/near/borsh.ts`, `web/src/near/delegate.ts`, `web/src/near/delegate.test.ts`.
  **Produces:**
  - `base58encode(b: Uint8Array): string` and `base58decode(s: string): Uint8Array`
  - `encodeDelegateAction(d: DelegateParams & {publicKey: string}): Uint8Array`
  - `type DelegateParams = {senderId: string; receiverId: string; nonce: bigint; maxBlockHeight: bigint; actions: {method: string; args: object; gas: bigint}[]}`
  - `type MerchantKey = {publicKey: string; sign(msg: Uint8Array): Promise<Uint8Array>}`
  - `signDelegate(key: MerchantKey, p: DelegateParams): Promise<string>`, which gives the base64 SignedDelegate
  - `keyFromSeed(seed: Uint8Array): Promise<MerchantKey>` (PKCS#8 import, non-extractable for signing)
  1. Tests:
     - `base58_roundtrip`: includes leading zero bytes.
     - `delegate_hash_prefix`: the first 4 bytes are `6e 01 00 40`.
     - `delegate_matches_relay`: for a fixed seed and a `create_invoice` action, the result equals `signDelegate` from `../../../relay/src/delegate.ts` run with `secretFromSeed(seed)`. Ed25519 is deterministic, so the base64 strings are equal.
     - `relay_decodes_web_delegate`: `decodeSignedDelegate` gives the same sender, receiver, method, gas, deposit `0n` and nonce.
  2. FAIL. 3. Implement. Port `Writer` and base58 from `relay/src/near.ts` without `node:crypto`, and use `crypto.subtle` for SHA-256 and Ed25519. 4. PASS. 5. Commit `feat(web): sign NEP-366 delegate actions`.
- [ ] 3.2 Passkey PRF and recovery-phrase keys (design decision 4). Verify that `npm test` passes the tests below. Then verify manually in Chrome, with the dev relay and a real passkey, that two `getPasskeyKey()` calls give the same `publicKey`
  **Files:** `web/src/near/key.ts`, `web/src/near/key.test.ts`.
  **Consumes:** `keyFromSeed`, `base58*`.
  **Produces:**
  - `seedFromPrf(prf: Uint8Array): Promise<Uint8Array>`
  - `createPasskeyKey(email: string): Promise<MerchantKey>`, which throws `PrfUnsupported`
  - `getPasskeyKey(): Promise<MerchantKey>`
  - `createFallbackKey(): Promise<{key: MerchantKey; phrase: string}>`
  - `restoreFallbackKey(phrase: string): Promise<MerchantKey>`
  - `loadStoredKey(): Promise<MerchantKey | null>`, whose `sign` runs a no-extension passkey `get` before signing
  - `keyMode(): "prf" | "stored" | null`
  - `ed25519Supported(): Promise<boolean>`, which tries `generateKey("Ed25519")` once; when it is false, SignIn shows "This browser can't hold a merchant key"
  - `assertOwner(key: MerchantKey, expected: string): void`, which throws "This passkey does not own this account"
  - `class PrfUnsupported extends Error {}`
  1. Tests:
     - `seed_from_prf_deterministic`: the same 32-byte input gives the same seed, and a different input gives a different seed.
     - `public_key_matches_seed`: `keyFromSeed(seed).publicKey` equals the relay's `signer(secretFromSeed(seed)).publicKeyString`.
     - `recovery_phrase_roundtrip`: parsing a phrase made from a seed gives the same public key.
     - `phrase_rejects_mismatched_pk`: a phrase whose last 32 bytes are not the seed's public key throws.
     - `owner_mismatch_throws`.
  2. FAIL. 3. Implement. The WebAuthn and IndexedDB calls are thin wrappers that are not unit-tested. 4. PASS, plus the manual check. 5. Commit `feat(web): passkey-derived merchant key`.

## 4. Console

- [ ] 4.1 Sign-in and onboarding (design decision 6). Verify that `npm test` passes `onboarding_screen`. Then verify manually against the dev relay (`gateflow-dev-v1.testnet`) that a new email reaches Home after the email, name, passkey and gateway-confirmation steps; that a reload mid-way resumes; and that sign-out shows the signed-out card. Also verify that the signed-out card passes the screenshot check against the export's "Logged out", and that the sign-in and onboarding cards use its card layout
  **Source:** Console "Logged out" block. The signed-out card is translated as is, and the other cards reuse its layout.
  **Files:** `web/src/console/SignIn.tsx`, `web/src/console/Onboarding.tsx`, `web/src/console/logic.ts`, `web/src/console/logic.test.ts`.
  **Consumes:** `api`, `createPasskeyKey`, `createFallbackKey`, `getPasskeyKey`, `loadStoredKey`, `restoreFallbackKey`, `assertOwner`, `signDelegate`.
  **Produces:**
  - `onboardingScreen(step: string, mode: "prf" | "stored" | null): "details" | "resume-key" | "gateway" | "done"`
  - `signAndRelay(key: MerchantKey, actions: DelegateParams["actions"]): Promise<{txHash: string; value: unknown}>`: it fetches `delegate-params`, runs `assertOwner`, signs, and posts to `/console/relay`
  1. Test `onboarding_screen`:
     - `account` with any mode gives `details`;
     - `tokens` with `null` gives `resume-key`, and with `prf` gives `details`;
     - `gateway` with `null` gives `resume-key`, and with `stored` gives `gateway`;
     - `done` gives `done`.
  2. FAIL. 3. Implement. The sign-in card shows the demo copy. A PRF-less authenticator shows the phrase with an "I saved it" checkbox that gates Continue. `payoutTo` is kept in `sessionStorage`. 4. PASS, plus the manual check. 5. Commit `feat(web): sign-in and onboarding`.
- [ ] 4.2 Layout, Home and Search. Verify that `npm test` passes `settled_today_totals` and `search_matches`. Then verify manually that the sidebar collapses, that Screening shows the Pending count, and that Cmd/Ctrl+K opens Search and Escape closes it. Also verify that the sidebar (expanded and collapsed), profile menu, Home and Search pass the screenshot check against the export
  **Source:** Console "Sidebar", "Profile menu", "New chat" and "Search" blocks.
  **Files:** `web/src/console/Layout.tsx`, `Home.tsx`, `Search.tsx`, `usePoll.ts`, and `logic.ts` and `logic.test.ts`.
  **Produces:**
  - `usePoll<T>(fn: () => Promise<T>, ms: number): {data?: T; error?: ApiError; refresh(): void}`
  - `settledToday(payments: Payment[], now: Date): {symbol: string; amount: string}[]`
  - `searchMatches(q: string, invoices: Invoice[], payments: Payment[]): {kind: "invoice" | "payment"; id: number; label: string}[]`
  - the row types `Invoice` and `Payment`, matching `/console/invoices` and `/console/payments` (design, Context)
  1. Tests:
     - `settled_today_totals`: two USDC payments of 10 and 5 Settled today, plus one Settled yesterday and one Pending today, give `[{symbol: "USDC", amount: "15"}]`.
     - `search_matches`:
       - `"0.01"` finds the 0.01 nBTC invoice and its payment, and not the 0.1 one;
       - `"#3"` and `"3"` find id 3;
       - a memo substring and a payer substring match, ignoring case;
       - `""` gives `[]`.
  2. FAIL. 3. Implement. The layout polls `me`, `gateway`, `invoices`, `payments` and `tokens`, and a 401 goes to SignIn. Home shows the greeting, a `Stat` per token, and the disabled composer with "Assistant coming soon". 4. PASS, plus the manual check. 5. Commit `feat(web): console layout, home, search`.
- [ ] 4.3 Invoices. Verify that `npm test` passes `invoice_tab_expired` and `create_invoice_args`. Then verify against the dev relay that a 1 wNEAR invoice appears Open, with a copyable `<origin>/pay/<id>` link, after one passkey prompt; that cancelling the prompt keeps the form values; and that hashes appear only under Details. Also verify that the Invoices screen and its create form pass the screenshot check against the export
  **Source:** Console "Invoices" block.
  **Produces:**
  - `invoiceTab(inv: Invoice, nowSec: number): "Open" | "Paying" | "Paid" | "Returned" | "Expired"`
  - `invoiceArgs(form: {gateway: number; token: string; decimals: number; amount: string; expiresInSec: 3600 | 86400 | 604800; memo: string}): {gateway; token; amount: string; expires_in_sec; memo?}`, which throws on a bad amount or a memo over 140 bytes
  1. Tests:
     - `invoice_tab_expired`: Open with `expires_at_sec` equal to `nowSec` gives Expired, and with `nowSec + 1` gives Open.
     - `create_invoice_args`: `"0.01"` at 8 decimals gives `amount: "1000000"`; an empty memo is omitted; a memo of 141 ASCII bytes or 47 three-byte characters throws.
  2. FAIL. 3. Implement `Invoices.tsx`: the tabs All, Open, Paying, Paid, Returned and Expired with counts; a create form whose token select lists only `enabled` tokens; and a detail `Dialog`. 4. PASS, plus the manual check. 5. Commit `feat(web): invoices`.
- [ ] 4.4 Screening and Settings. Verify that `npm test` passes `screening_tabs` and `payer_label`. Then verify against the dev relay that setting risk tolerance to 20 makes `get_gateway` show `max_risk: 20` after one prompt, and that switching a token off removes it from the invoice form. Also verify that Screening passes the screenshot check against the export's "AML", that Settings "Blockchains & Tokens" passes it against the export tab, and that the Gateway tab matches the "Compliance BYOK" panel layout
  **Source:** Console "AML" and "Settings" blocks.
  **Produces:**
  - `screeningTab(p: Payment): "Pending" | "Refunded" | "Failed" | undefined`
  - `payerLabel(p: Payment): string`
  1. Tests:
     - `screening_tabs`: `SettleFailed` and `RefundFailed` give Failed, and `Settled` gives `undefined`.
     - `payer_label`: a payment with `reference` and payer `intents.near` gives its `refund_to`, and a direct one gives `payer`.
  2. FAIL. 3. Implement:
     - `Screening.tsx`: the Pending, Refunded and Failed tabs with counts, amount, token, invoice, payer and age, plus Retry on Failed (`POST /console/retry`, then refresh).
     - `Settings.tsx`: the export's Settings overlay with two tabs.
       - Gateway: the payout account, fuel shown as "Ready" or "Topping up" from `fuelReady`, and the risk slider. Saving relays `set_policy`.
       - Tokens & chains: switches that call `PUT /console/preferences`, and a read-only origins list (NEAR, Base, Ethereum, Arbitrum, Bitcoin, Zcash).
  4. PASS, plus the manual check. 5. Commit `feat(web): screening and settings`.

## 5. Checkout

- [ ] 5.1 Invoice page and timeline (design decision 9). Verify that `npm test` passes the tests below. Then verify manually that `/pay/999999` shows "Invoice not found" with no options, and that the dev invoice 0 shows "Kaja Coffee", its amount and the countdown. Also verify that the left card and the processing state pass the screenshot check against the export's "complete" and "returned" outcomes
  **Source:** Checkout left card and processing state.
  **Files:** `web/src/checkout/Checkout.tsx`, `Timeline.tsx`, `logic.ts`, `logic.test.ts`.
  **Produces:**
  - `type CheckoutInvoice`, matching `/checkout/invoice` plus `contract`
  - `unpayable(inv: CheckoutInvoice, nowSec: number): "paid" | "returned" | "expired" | undefined`
  - `timeline(inv: CheckoutInvoice, quoteStatus?: string): {label: string; state: "done" | "current" | "todo"; detail?: string}[]`
  1. Tests:
     - `unpayable_states`: Paid, Returned, and Paying (which gives `undefined`, so the timeline shows instead).
     - `unpayable_at_expiry_boundary`: `expiresAtSec === nowSec` gives `"expired"`.
     - `timeline_direct_pending`: three steps, with no Deposit step; Delivered is done and Screening is current.
     - `timeline_cross_chain_detected`: `PROCESSING` with an Open invoice; Deposit is done and Delivered is current.
     - `timeline_paid`: the last label is "Released to merchant".
     - `timeline_returned`: "Returned to you", with `detail` equal to `payment.refundTo`.
     - `timeline_origin_refund`: `REFUNDED` with an Open invoice gives step 1 "Returned on the origin chain", and the later steps are `todo`.
  2. FAIL. 3. Implement the two-column design layout: the invoice card (merchant, amount, id, memo, countdown and the custody explanation), the unpayable cards, and the payment options. Poll every 5 s. 4. PASS, plus the manual check. 5. Commit `feat(web): checkout page and timeline`.
- [ ] 5.2 Pay with a NEAR wallet (design decision 7). Verify that `npm test` passes `transfer_call_args` and that `npm run build` emits wallet-selector in a separate chunk. Then verify on testnet that choosing the option shows the named-account warning before the wallet modal, and that a payment from a named testnet account turns the timeline into "Returned to you". Also verify that the form with "Browser wallet" selected passes the screenshot check against the export
  **Source:** Checkout form state, "Pay with" tiles, Pay button.
  **Files:** `web/src/checkout/NearPay.tsx`, `web/src/checkout/wallet.ts`, and `logic.ts` and `logic.test.ts`.
  **Produces:**
  - `transferCallArgs(inv: CheckoutInvoice): {receiverId: string; method: "ft_transfer_call"; args: {receiver_id: string; amount: string; msg: string}; gas: string; deposit: string}`
  - `payDirect(inv: CheckoutInvoice): Promise<void>`
  1. Test `transfer_call_args`: for invoice 7 on `wrap.testnet` with contract `gateflow-dev-v1.testnet`:
     - `receiverId` is `wrap.testnet`;
     - `msg` is exactly `'{"invoice":7}'`;
     - `gas` is `"300000000000000"` and `deposit` is `"1"`.
  2. FAIL. 3. Implement. `wallet.ts` is loaded with `import()` from `NearPay` only. 4. PASS, plus the manual check. 5. Commit `feat(web): pay with a NEAR wallet`.
- [ ] 5.3 Pay from another chain (design decision 8). Verify that `npm test` passes the tests below. Then verify manually, against a relay whose `ONECLICK_URL` points at a local stub serving `relay/src/fixtures/oneclick-tokens.json` and a canned quote, that the amount, deposit address, QR code, memo and countdown render, and that a reload resumes them. Also verify that the form with "Address or QR" selected passes the screenshot check against the export, with the refund fields in place of "Sender information"
  **Source:** Checkout form state, "Address or QR" panel and the "Sender information" block's field layout.
  **Files:** `web/src/checkout/CrossChainPay.tsx`, and `logic.ts` and `logic.test.ts`. The stub is a scratchpad script and is not committed.
  **Produces:**
  - `quoteFormError(f: {originAsset: string; refundTo: string; refundOnNear: string}): "originAsset" | "refundTo" | "refundOnNear" | undefined`
  - `type SavedQuote = {ref: string; depositAddress: string; depositMemo: string | null; amountIn: string; amountInFormatted: string | null; deadline: string}`
  - `saveQuote(invoice: number, q: SavedQuote): void`, `loadQuote(invoice: number): SavedQuote | undefined` and `clearQuote(invoice: number): void`, each taking an optional `Storage` argument for tests
  1. Tests:
     - `quote_form_requires_both_refunds`: an empty `refundTo` gives `"refundTo"`, and `"Bob.near"` gives `"refundOnNear"`.
     - `saved_quote_roundtrip`.
     - `saved_quote_bad_storage`: corrupt JSON gives `undefined`, and a `Storage` whose methods throw gives `undefined` without an error.
  2. FAIL. 3. Implement. The asset picker is grouped by chain with `chainIcon`, the QR code comes from `qrcode.toString(addr, {type: "svg"})`, and `/checkout/status` is polled while a quote is saved. 4. PASS, plus the manual check. 5. Commit `feat(web): pay from another chain`.

## 6. Integration

- [ ] 6.1 Run the testnet check (design decision 14) and record it. Verify each check below, then record the results in `web/README.md` and update the README Status
  1. Build `web/`. Start the relay against `gateflow-dev-v1.testnet` with `WEB_DIST=../web/dist`.
  2. With Playwright and a CDP virtual authenticator with `hasPrf: true`, check that:
     - a new email onboards;
     - `near account list-keys <slug>.gateflow-op-v1.testnet` shows exactly the derived key;
     - a 1 wNEAR invoice is created;
     - Search finds it by amount;
     - risk tolerance can be changed to 20.
  3. Repeat onboarding with `hasPrf: false`. Check that the phrase screen appears, that Continue is gated by the checkbox, and that `restoreFallbackKey` in a fresh browser context restores the same account.
  4. The owner pays the invoice from a named testnet wallet holding wNEAR. Check that the checkout shows "Returned to you", that the console shows the invoice as Returned, and that the payment is under Screening → Refunded.
  5. In `README.md` Status: `web/` is implemented and checked on testnet, and the Ethereum-wallet option and a mainnet payment are still open. Update the `VITE_REOWN_PROJECT_ID` row to point at this change. Then run `openspec validate web-from-scratch --strict`.
  6. Commit `docs: web status and testnet run`.

## Workflow follow-up

- Run `/opsx:archive web-from-scratch` after review. This syncs the `payer-checkout` and `checkout-relay` deltas.
- `console-ai-chat` lists `web-console-checkout` as its prerequisite, but that change is archived and its code is missing. Its tasks should name `web-from-scratch` instead.
- Still deferred: the `ethereum-wallets` payer option behind `VITE_REOWN_PROJECT_ID`, and a settled payment end to end (`mainnet-launch`).
