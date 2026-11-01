# Proposal

## Why

Gateflow has no user interface. Two design exports exist, `Gateflow Console.html` (merchant) and `Gateflow Checkout.html` (payer). They use mock data and show flows the system no longer has. Merchants should not need a wallet, NEAR or gas. This change merges both designs into one app on the real contract, non-custodial for merchants but with the chain hidden from them.

## What Changes

- **New `web/` app** (Vite, React, TypeScript) with two layouts:
  - the merchant console: Home, Invoices, Screening, Settings and Search;
  - the public payer checkout at `/pay/:invoice`.
  The design tokens, fonts, logos and components are ported from the exports. The design's chat composer stays on Home but is disabled until `console-ai-chat`.
- **Merchant accounts, non-custodial.**
  - Sign-in is by email only, which is demo-grade and unverified, and an email session can only read.
  - The merchant's ed25519 key is derived from a passkey through the WebAuthn PRF extension. A recovery-phrase key is the fallback.
  - The operator creates `<slug>.<operator>` with the merchant's public key as its only key.
  - Every write is a NEP-366 delegate action the merchant signs with a passkey prompt. The backend relays it and pays the gas.
- **Onboarding provisions everything.** It creates the account, registers token storage, has the merchant sign `create_gateway`, and the operator funds the gateway's fuel. The merchant never holds NEAR.
- **The relay becomes the backend.**
  - It keeps state in SQLite (`node:sqlite`) for merchants, sessions and quotes.
  - It serves the built `web/` and adds `/console/*` routes.
  - It sponsors only allowlisted Gateflow calls.
  - A watcher triggers `screen_intents` once 1Click reports `SUCCESS`, so payers can close the tab.
  - It tops up gateway fuel automatically.
- **Checkout payment options:**
  - pay with any NEAR wallet (wallet-selector, `ft_transfer_call`), with a warning that payments from named NEAR accounts are refunded by current screening;
  - pay from another chain (a 1Click quote, a deposit address with QR code, and a required refund address).
  The timeline has four steps: deposit detected, delivered, screening, then released or returned.
- **Design retargeted to the real system:** no Travel Rule form, no sign credit or freeze, and statuses come from the contract.

## Capabilities

### New Capabilities
- `merchant-accounts`: email session, passkey-derived key, operator-provisioned account and gateway, write authority.
- `sponsored-transactions`: the backend relays merchant-signed delegate actions to allowlisted Gateflow methods and pays gas and fuel.
- `merchant-console`: what the merchant sees and can do (invoices, screening, settings, search).
- `payer-checkout`: the public invoice page, both payment paths and the status timeline.

### Modified Capabilities
- `checkout-relay`: adds the invoice details endpoint and backend-driven deferred screening.

## Impact

- **New:** `web/`, with npm dependencies for React, Vite, `lucide-react`, `@near-wallet-selector/*` and `qrcode`.
- **Relay:** `relay/src/` gains a database, sessions, console routes, the delegate relayer, account creation and the watcher. It stays on Node built-ins.
- **Dependency:** requires `contract-invoices-views`, for invoices, views and the token allowlist.
- **Env:** `PUBLIC_URL`, `DB_PATH`, `FUEL_TARGET`, `WEB_DIST`.
- Export files stay untracked as references.
