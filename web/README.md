# Gateflow web

The merchant console and the public checkout (`/pay/<invoice>`), as one Vite + React app. The relay serves the built `dist/` and the API from one origin.

## Commands

```sh
npm ci
npm run dev     # http://localhost:5173, proxies /console and /checkout to the relay on 8787
npm test        # Vitest, node environment
npm run build   # type-check, then write dist/
```

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `VITE_NEAR_NETWORK` | `testnet` | Network for the checkout's NEAR wallets |

The page reads the Gateflow contract account from `GET /checkout/invoice`. Checkout links use the page's own origin.

## Merchant keys and the hostname

A merchant's key is derived from their passkey, and passkeys are bound to the site's hostname (the WebAuthn `rp.id`). The same passkey gives the same key only on the same hostname. Moving the app to another domain needs the recovery phrase (fallback keys) or a new merchant account.

## Wallets

The checkout's "Browser wallet" option offers MyNearWallet and Meteor through wallet-selector 10. Their code loads only when a payer chooses that option, together with `src/checkout/node-shims.ts`, which supplies the Node `global` and `process` the wallet bundles expect. HERE Wallet is left out: with it, the pay call returned without any wallet prompt.

## Checks so far (2026-11-02)

The app was driven with Playwright (Chromium, CDP virtual authenticators) against a local relay: the real `relay/src/main.ts` server and routes over the fakes in `relay/src/testing.ts`, with an in-memory contract and 1Click fixtures. Every screen was compared side by side with the matching screen of `design/Gateflow Console.html` or `design/Gateflow Checkout.html` at 1440×900 and 390×844.

- **Onboarding:** with PRF, email, business name, passkey and gateway confirmation reach Home; a reload resumes; sign-out shows the exported "You are signed out" card. Without PRF, the recovery phrase gates Continue, and a fresh browser restores the account from the phrase.
- **Console:** today's settled total, the Screening count, ⌘K search and Escape, invoice creation with one passkey prompt (hash only under Details), a cancelled prompt keeps the form, risk tolerance 20 with one prompt, a token switched off leaves the invoice form, Retry on a failed payment.
- **Checkout:** unknown and expired invoices show no payment options; the named-account warning shows before the wallet picker opens; the 1Click quote shows the amount, deposit address, QR code and countdown, and survives a reload; a missing refund field sends no quote.

Not yet done: the same run against the testnet dev deployment (`gateflow-dev-v1.testnet`), and a payment from a named testnet account that should end as "Returned to you". Both need the operator key and a funded testnet wallet (`web-from-scratch` task 6.1).
