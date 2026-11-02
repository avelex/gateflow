# Design

## Context

See proposal.md, "Why". Requirements: `merchant-console`, `payer-checkout` and the browser parts of `merchant-accounts` (passkey key, recovery phrase, onboarding UI), plus this change's deltas.

**Backend, as built by `relay-from-scratch`** (`relay/src/console.ts`, `relay/src/checkout.ts`):
- **Console:**
  - `POST /console/session {email}` → `{step}`, `DELETE /console/session`, and `GET /console/me` → `{email, name, accountId, gatewayId, step}`. Steps are `account`, `tokens`, `gateway` and `done`.
  - `POST /console/onboard {name, publicKey, payoutTo?}` → `{step, accountId}`. It runs `account` and `tokens` and stops at `gateway`.
  - `GET /console/delegate-params` → `{nonce, maxBlockHeight, publicKey}`, as strings.
  - `POST /console/relay {signedDelegate}` → `{txHash, value}`. A relayed `create_gateway` sets `step = done` and funds the gateway.
  - Data routes:
    - `GET /console/gateway` → `{id, owner, payout_to, policy: {max_risk}, fuel, fuelReady, invoices, payments}`;
    - `GET /console/invoices` and `GET /console/payments`: newest first, each row `{id, …contract fields, tokenMeta: {symbol, decimals}}`;
    - `GET /console/tokens` → `[{token, symbol, decimals, enabled}]`;
    - `PUT /console/preferences {tokensOff}` and `POST /console/retry {payment}`.
  - Errors are `{error}`: 401 means no session, and 409 "finish onboarding first".
- **Checkout:**
  - `GET /checkout/invoice?id=` → `{id, gateway, merchant, token, symbol, decimals, amount, memo, expiresAtSec, status, payment: {id, status, refundTo} | null}`;
  - `GET /checkout/assets` → `[{assetId, chain, symbol, decimals}]`;
  - `POST /checkout/quote {invoice, originAsset, refundTo, refundOnNear}` → `{ref, depositAddress, depositMemo, amountIn, amountInFormatted, deadline}`;
  - `GET /checkout/status?depositAddress=` → `{status, screening}`.
- The relay serves `WEB_DIST` (default `../web/dist`) with an SPA fallback.

**Contract:**
- `InvoiceStatus` is `Open | Paying | Paid | Returned`.
- `PaymentStatus` is `Pending | Settled | Refunded | SettleFailed | RefundFailed`.
- A `Payment` has `payer`, `refund_to`, `reference?`, `opened_at_sec` and `status`. A 1Click payment's `payer` is `intents.near`.
- `PayMsg` is `{invoice, refund_to?, ref?}`.

**Design exports** (`design/*.html`, tracked). These are the source of the UI.
- **Bundle format:** `__bundler/manifest` maps UUIDs to `{mime, compressed, data}`. The data is base64, gzip-compressed when `compressed` is set. `__bundler/ext` names some UUIDs: `chain_usdc`, `chain_polygon`, `chain_zcash`, `chain_bitcoin` and `chain_ethereum`, plus the React UMD files.
- **Assets:** woff2 fonts (Schibsted Grotesk, IBM Plex Mono), logo PNGs, chain icons and scripts:
  - React and ReactDOM 18.3.1 UMD;
  - `lucide` 0.469.0 UMD;
  - the `dc-runtime` template engine;
  - the `DeflowDesignSystem_0655fb` bundle.
- **Components:** the design-system bundle is identical in both exports. It is readable, unminified, compiled JSX (`React.createElement`) of 19 components: `Button`, `Icon`, `IconButton`, `Badge`, `Card`, `Hash`, `Stat`, `StatusBadge`, `Tag`, `Dialog`, `Toast`, `Tooltip`, `FlowSteps`, `Checkbox`, `Input`, `Radio`, `Select`, `Switch` and `Tabs`. They style through the token variables. `Icon` reads `window.lucide.icons[PascalName]`.
- **Template:** `__bundler/template` is a JSON string of the page:
  - `<style>` blocks: `@font-face` rules, `:root` tokens, base rules and keyframes;
  - markup in a template DSL, with inline styles on every element: `<sc-if value>`, `<sc-for list as>`, `<x-import component-from-global-scope="DeflowDesignSystem_0655fb.X" …props>`, `{{ binding }}`, `sc-camel-on-*` handlers and `style-hover` (11 in the console, none in the checkout);
  - a `class Component extends DCLogic` with mock state and handlers.
- **Console screens** (`data-screen-label`): Sidebar, Profile menu, New chat (Home), Chat, Invoices, AML, Search, Settings (tabs "Compliance BYOK" and "Blockchains & Tokens") and Logged out.
- **Checkout:** one screen.
  - The left card shows the merchant, amount, facts, "What happens to your payment" and "Secured by".
  - The right side has a form state: Travel Rule sender information, "Pay with" tiles "Browser wallet" and "Address or QR", and the Pay button.
  - It also has a processing state: badge, title, text, timeline rows with check badges, and the Email me updates, View on explorer and Restart buttons.
- **Mock data:** "Tallinn Pay AS", "Kaja Mets · MLRO" and a CASP licence line.

**Prior art:** the archived `web-console-checkout` design (decisions 2, 3, 9, 10) and tasks 1.1, 2.1–2.2 and 5.1–6.4 describe this app. Its code is not in this repository. Names are kept where they still fit.

## Goals / Non-Goals

**Goals:**
- `npm run build` gives a static `web/dist` that the relay serves. The page needs no runtime config beyond the build-time `VITE_NEAR_NETWORK`.
- Every rule with a branch is a pure function covered by Vitest in the node environment. There are no DOM or component tests.
- Every in-scope export screen is reproduced from its own markup, with the exports' components, tokens, fonts, images and copy.
- **Fidelity check:** Playwright screenshots of the app screen and the export, at 1440×900 and 390×844, compared side by side. The export is navigated to the same screen through its own UI. Layout, type, colour and spacing must match. Only data and the replacements in decision 13 may differ.

**Non-Goals:**
- A router, state-management or form library, CSS-in-JS, or a NEAR SDK in the console.
- Automated pixel diffs. The data differs from the exports' mock data.
- New visual language: no colour, font, size, spacing, radius or shadow outside `tokens.css`, the exports' inline styles and `ds.jsx`.
- Offline support, i18n and mobile-specific layouts beyond the exports' own responsive rules.

## Decisions

**1. Layout.**

```
web/
  index.html  vite.config.ts  package.json  tsconfig.json
  src/
    main.tsx        mounts <App/>
    App.tsx         pathname switch, navigate()
    api.ts          get/post/put/del over fetch, ApiError {status, message}
    format.ts       formatAmount, parseAmount, isNearAccount, timeLeft
    tokens.css      the template <style> blocks, verbatim (fonts, :root tokens, base rules, keyframes)
    ds.jsx          the DeflowDesignSystem bundle as an ES module (19 components)
    ds.d.ts         prop types for ds.jsx
    screens.css     the exports' style-hover rules as :hover classes
    assets/         fonts/, logo, logo-mark, chain-*.png
    near/
      borsh.ts      base58, Writer, encodeDelegateAction, encodeSignedDelegate
      key.ts        MerchantKey: passkey PRF and recovery-phrase modes
      delegate.ts   signDelegate(key, params) -> base64
    console/        SignIn, Onboarding, Layout, Home, Invoices, Screening, Settings, Search, logic.ts
    checkout/       Checkout, NearPay, CrossChainPay, Timeline, wallet.ts, logic.ts
```

- Each screen keeps its pure rules in `logic.ts`, so tests import no React.
- Vite's dev server proxies `/console` and `/checkout` to `http://localhost:8787`.
- *Rejected:* separate console and checkout bundles. They share the design and the API client, and Vite code-splitting already keeps wallet-selector out of the console (decision 7).

**2. Routing without a library.**
- `App` switches on `location.pathname`:
  - `/pay/<digits>` goes to `Checkout`;
  - `/`, `/invoices` and `/screening` go to the console;
  - anything else redirects to `/`.
- Settings and Search are the exports' overlays, built on `Dialog` where the markup uses it. Details sections use a native `<details>`, styled with token variables.
- `navigate(path)` is `history.pushState` plus a `popstate` listener, about 15 lines.

**3. Console state and polling.**
- Polling is a `usePoll(fn, ms)` hook: it runs on mount, then every `ms`, and again on window `focus`. The console polls every 15 s and the checkout every 5 s.
- The console loads `me`, `gateway`, `invoices`, `payments` and `tokens` once per poll at the layout level and passes them down. There is no global store.
- After a write, the console polls again at once.
- A 401 from any call goes to SignIn.

**4. Merchant key (`near/key.ts`).** `MerchantKey = {publicKey: string /* ed25519:… */, sign(msg): Promise<Uint8Array>}`.
- **PRF mode:**
  1. Create the passkey with `navigator.credentials.create`: `residentKey: "required"`, `userVerification: "required"`, `rp.id = location.hostname`, and `extensions.prf.eval.first = SHA-256("gateflow/merchant-key/v1")`.
  2. If the create result carries `prf.results.first`, use it. Otherwise, if `prf.enabled` is true, run one `navigator.credentials.get` with the same salt, because Safari returns PRF output only on `get`. If `prf.enabled` is false, throw `PrfUnsupported`.
  3. The seed is `HKDF-SHA256(prf, salt = empty, info = "ed25519", 32 bytes)`.
  4. Wrap the seed in PKCS#8 (prefix `302e020100300506032b657004220420`) and import it as an extractable Ed25519 key once, to read the public key from `exportKey("jwk").x`. Then import it again as non-extractable for signing.
  5. Nothing is stored except `localStorage["gateflow:keyMode"] = "prf"`. Each signature runs a fresh `get`, which is the spec's one passkey prompt.
- **Fallback mode:**
  1. `generateKey("Ed25519", true)` creates the key.
  2. Export it once as `ed25519:<base58(seed || publicKey)>`. That string is the recovery phrase, and it imports into any NEAR wallet.
  3. Store a non-extractable copy as a `CryptoKey` in IndexedDB (`gateflow` / `keys` / `merchant`) and set `keyMode = "stored"`.
  4. The passkey created in step 1 of PRF mode still exists. Before each signature, run a `get` with no extension as the confirmation prompt, then sign with the stored key.
- **Restore:** `restoreFallbackKey(phrase)` parses the phrase, checks that the public key matches the seed, and stores the key.
- **Ownership check:** before signing, the derived `publicKey` is compared with `delegate-params.publicKey`. A mismatch fails with "This passkey does not own this account", so nothing is sent.
- *Rejected:* `@noble/ed25519`, which keeps seed bytes in JS memory, and an embedded or MPC wallet, which is custodial or a vendor dependency.

**5. Delegate signing (`near/borsh.ts`, `near/delegate.ts`).**
- Base58, the Borsh `Writer`, the FunctionCall action, `DelegateAction` and `SignedDelegate` are ported from `relay/src/near.ts` and `relay/src/delegate.ts`, without `node:crypto`. That is about 90 lines.
- The signing hash is `sha256(u32le(2^30 + 366) || borsh(DelegateAction))`, computed with `crypto.subtle.digest`.
- `signDelegate(key, {senderId, receiverId, nonce, maxBlockHeight, actions: [{method, args, gas}]})` returns base64. The deposit is always 0.
- Gas is 30 Tgas for `create_gateway`, `create_invoice` and `set_policy`, under the 100 Tgas allowlist cap.
- A Vitest test imports the relay's own `encodeDelegateAction` and `decodeSignedDelegate` (Vitest runs in Node) and checks that the bytes are equal, so the two encoders cannot drift.
- *Rejected:* `@near-js/transactions`. It is a large dependency for 90 lines, and wallet-selector would pull in a second copy at another version.

**6. Onboarding flow** (`console/Onboarding.tsx`), driven by `me.step`:
- **`account`:**
  1. Ask for the business name and an optional payout account, validated by `isNearAccount`.
  2. Create the key: PRF mode, or the fallback if PRF is unsupported.
  3. In fallback mode, show the phrase with a "I saved it" checkbox, and continue only once it is ticked.
  4. Post `POST /console/onboard`.
- **`tokens`:** re-derive the key and post `onboard` again, which resumes.
- **`gateway`:** one passkey prompt signs `create_gateway({payout_to: payoutTo ?? accountId, policy: {max_risk: 50}})`, then `POST /console/relay`.
- **`done`:** go to Home.
- On a new device, when `step != account` and there is no stored key:
  - offer "Use my passkey" (PRF);
  - or "Enter recovery phrase" (fallback restore).
- `payoutTo` is kept in `sessionStorage` between steps, because the backend does not store it.

**7. Checkout wallets (`checkout/wallet.ts`).**
- `@near-wallet-selector/core` and `modal-ui`, with the `my-near-wallet`, `meteor-wallet` and `here-wallet` modules, on `VITE_NEAR_NETWORK` (default `testnet`).
- The whole module is loaded with a dynamic `import()` only when the payer picks the NEAR wallet option, so the console bundle and the first checkout paint stay small.
- `payDirect(invoice)` signs and sends one transaction to `invoice.token`: `ft_transfer_call({receiver_id: invoice.contract, amount: invoice.amount, msg: JSON.stringify({invoice: invoice.id})})`, with 1 yoctoNEAR attached and 300 Tgas.
  - 300 Tgas, because `ft_on_transfer` forwards 100 Tgas to OutLayer plus a callback. The archived 6.3 ran out of gas at 100 Tgas.
- Wallet versions are pinned by `package-lock.json`. The action format follows the pinned version's documentation.
- *Rejected:* `ethereum-wallets`. It is out of scope (see the proposal).

**8. Cross-chain checkout.**
- The form has an asset picker from `/checkout/assets`, grouped by chain, with chain icons from the export. It also asks for the origin refund address and the NEAR refund account.
- `quoteFormError(form)` returns the first missing field. While it is set, the page asks for that field and sends no quote.
- After a quote, the page shows `amountInFormatted` (or `amountIn` formatted with the asset's decimals), the deposit address with a QR code (`qrcode.toString(addr, {type: "svg"})`) and a copy button, `depositMemo` when present, and the deadline countdown.
- The quote is saved in `localStorage["gateflow:quote:<invoice>"]`, inside try/catch, so a reload resumes the timeline. It is cleared once the invoice is no longer Open or Paying.

**9. Timeline (`checkout/logic.ts`).** `timeline(invoice, quoteStatus?)` returns four steps, each `{label, state: "done" | "current" | "todo"}`:
1. **Deposit detected:** only with a quote. Done when the 1Click status is not `PENDING_DEPOSIT` or `UNKNOWN`.
2. **Delivered to contract:** done when the invoice is `Paying`, `Paid` or `Returned`.
3. **Screening in enclave:** current while the invoice is `Paying`, and done after it.
4. **Final step:** "Released to merchant" when the invoice is `Paid`. "Returned to you" when it is `Returned`, with `payment.refundTo`.

1Click `REFUNDED` or `FAILED` before delivery shows "Returned on the origin chain" in step 1. In that case the swap failed and 1Click refunded `refundTo`.

`unpayable(invoice, nowSec)` returns `"paid"`, `"returned"`, `"expired"` or `undefined`. A `Paying` invoice shows the timeline, not the options.

**10. Console rules (`console/logic.ts`).**
- `invoiceTab(inv, nowSec)`: `Expired` is `Open` with `expires_at_sec <= nowSec`.
- `screeningTab(p)`: `Pending`, `Refunded`, or `Failed` for `SettleFailed` and `RefundFailed`. `Settled` has no tab.
- `settledToday(payments, now)` sums `Settled` payments whose `opened_at_sec` falls on the local calendar day, per token, as bigints. The contract stores no settle time, so the open time stands in.
- `payerLabel(p)`: `refund_to` when `reference` is set (1Click delivered it from `intents.near`), and `payer` otherwise.
- `searchMatches(q, invoices, payments)`: a case-insensitive match on id, formatted amount, symbol, memo or payer. A numeric query also matches the exact formatted amount.
- Risk tolerance is a slider from 0 to 80 in steps of 5, mapped one to one to `max_risk`.

**11. Amounts (`format.ts`).**
- `formatAmount(raw: bigint, decimals)`: string math only, with trailing zeros trimmed.
- `parseAmount(text, decimals)`: throws on more fractional digits than `decimals`, on non-digits, and on zero.
- `isNearAccount` copies the relay's `NEAR_ACCOUNT` regex and its length bounds.

**12. Relay edit.** `GET /checkout/invoice` adds `contract: deps.cfg.gateflow`. The test `checkout_invoice_contract` covers it.
- *Added during apply (4.1):* `GET /console/delegate-params` also returns `senderId` (the merchant account) and `receiverId` (the contract), so the console can build delegates without its own config. The test `delegate_params_nonce_plus_one` covers it.

**13. Design from `design/`.** The exports are the UI source. Screens are translated from them, not redesigned.
- **Extraction:** a one-off script, in the scratchpad and not committed, reads both manifests and writes:
  - the fonts, under `assets/fonts/`;
  - the images, named by their `ext` id (`chain-bitcoin.png`, …) or by role (`logo.png`, `logo-mark.png`);
  - every template `<style>` block, verbatim, into `tokens.css`, with the UUID `url()`s rewritten to the asset paths;
  - the design-system bundle, as the input for `ds.jsx`.
  Assets used by both exports are written once.
- **`ds.jsx`:** each component body is kept as exported. Only these change:
  - the `__ds_ns` and `try`/`catch` wrappers are removed;
  - the file adds `import React from "react"` and `export {…}` for the 19 names;
  - `Icon`'s `window.lucide` becomes `import { icons } from "lucide"`.
  There is no restyling and there are no new variants. A component the screens need that the bundle lacks is written in the bundle's own style, from tokens.
- **Translation rules** (markup to JSX):
  - `<sc-if value={{x}}>` becomes `{x && …}`;
  - `<sc-for list={{xs}} as="x">` becomes `{xs.map(x => …)}`;
  - `<x-import component-from-global-scope="DeflowDesignSystem_0655fb.X" a="…">` becomes `<X a="…">`;
  - `sc-camel-on-click` and `sc-camel-full-width` become `onClick` and `fullWidth`;
  - inline `style` strings become style objects with the same values;
  - `style-hover` becomes a class in `screens.css`;
  - `{{ binding }}` becomes a value from API data or local state. The mock `DCLogic` state is not ported.
- **Content replacements:**
  - "Tallinn Pay AS" becomes the merchant name, and "TP" its initials;
  - "Kaja Mets · MLRO" becomes the email, and the CASP licence line is dropped;
  - "Log out" becomes "Sign out";
  - the "0.01 BTC" placeholders become the invoice amount and token, with the matching chain icon.
- **Screen map:**

| Export screen | App | Changes |
|---|---|---|
| Sidebar, Profile menu | `console/Layout.tsx` | Nav: Home, Invoices, Screening (export label "AML"), Search. The Recents block is hidden until `console-ai-chat`. Profile menu: Settings, Sign out |
| New chat | `console/Home.tsx` | Greeting and "Today you processed" from `settledToday`. The composer is disabled, with "Assistant coming soon" |
| Invoices | `console/Invoices.tsx` | Tabs are the spec's All, Open, Paying, Paid, Returned and Expired. The create form uses the export's controls |
| AML | `console/Screening.tsx` | Tabs are Pending, Refunded and Failed. The Needs review, Frozen and Travel Rule states are dropped. Retry on Failed |
| Search | `console/Search.tsx` | Result rows as in the export |
| Settings | `console/Settings.tsx` | "Blockchains & Tokens" is kept. "Compliance BYOK" is replaced by "Gateway" (payout account, fuel status, risk slider), laid out like the BYOK panel |
| Logged out | `console/SignIn.tsx`, `console/Onboarding.tsx` | The signed-out card as exported. Sign-in, onboarding, the recovery phrase and resume-key reuse that card's layout |
| Chat | not built | `console-ai-chat` |
| Checkout, left card | `checkout/Checkout.tsx` | Facts: invoice id, expires in, memo. "What happens to your payment" lists held, screened, then released or returned |
| Checkout, form | `checkout/NearPay.tsx`, `checkout/CrossChainPay.tsx` | "Browser wallet" is the NEAR wallet, with the named-account warning. "Address or QR" is 1Click. The Travel Rule "Sender information" block becomes the asset `Select` and the two refund `Input`s, shown for Address or QR only. The QR placeholder icon becomes the real QR code. The ownership-signature line is dropped |
| Checkout, processing | `checkout/Timeline.tsx` | The four timeline rows of decision 9. Check badges show screening state only. Email me updates, View on explorer and Restart are dropped. The text says the payer may close the page |

**14. Live check.**
- Run against the dev deployment from `relay/README.md` (`gateflow-dev-v1.testnet`, operator `gateflow-op-v1.testnet`, token `wrap.testnet`).
- Playwright drives Chromium with a CDP virtual authenticator (`WebAuthn.addVirtualAuthenticator`, `ctap2`, `hasResidentKey`, `hasUserVerification`, `isUserVerified`):
  - with `hasPrf: true` for the PRF path;
  - with `hasPrf: false` for the fallback path.
- The owner makes the NEAR wallet payment by hand from a named testnet account holding wNEAR. The placeholder enclave refunds it.

## Risks / Trade-offs

- [The exports target React 18.3.1 UMD globals] → Pin `react` and `react-dom` to 18.3.1, and import React in `ds.jsx` instead of using the global.
- [A DSL construct in the markup has no rule in decision 13] → The implementer adds the rule to decision 13 before translating that screen, rather than restyling around it.

- [PRF is missing on some authenticators (older Windows Hello, some Android)] → The recovery-phrase fallback covers it. Fallback keys live in one browser's IndexedDB until restored elsewhere.
- [WebCrypto Ed25519 needs Chrome 137+, Safari 17+ or Firefox 129+] → The page checks support on load and shows "This browser can't hold a merchant key". The checkout does not need it.
- [Deriving the same key from PRF depends on the same `rp.id`] → Keys are bound to the deployment's hostname. Moving domains needs the fallback phrase or a new account. This is accepted for the hackathon and stated in `web/README.md`.
- [wallet-selector's action format and modal API change between majors] → Pinned by the lockfile, and loaded only on the checkout NEAR path.
- [Every NEAR-wallet payment on the dev deployment is refunded (placeholder enclave), and named accounts are refunded by design] → The live check expects "Returned to you". "Released to merchant" is covered by the unit test `timeline_paid` and by `mainnet-launch`.
- [The cross-chain path cannot run on testnet (1Click is mainnet only)] → `CrossChainPay` is checked against a relay whose `ONECLICK_URL` points at a local stub that serves the relay's own fixtures.
- [The settle time is approximated by the open time in "processed today"] → A payment opened before midnight and settled after it counts on the earlier day. The gap is screening time, so this is accepted.

## Migration Plan

1. Land the relay edit with `npm test` green.
2. Build `web/`, then start the relay against the dev deployment and run decision 14's checks.
3. Rollback: delete `web/dist`. The relay then answers 404 JSON for pages, and no on-chain state depends on the web app.
