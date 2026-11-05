# Proposal

## Why

A shop can only take Gateflow payments if someone creates each invoice by hand in the console and confirms it with a passkey. That rules out any store with a cart. Shop developers expect a Stripe-style integration: a secret key, one HTTP call per order, a checkout modal and a webhook. They should not need to know about NEAR, wallets or gas.

## What Changes

- **Enable API** in the console. One passkey prompt adds the relay's invoice signer key to the merchant account. It is a FunctionCall access key with receiver the Gateflow contract and methods `[create_invoice]` only. **Disable API** removes it.
- **API keys** (`gf_live_` / `gf_test_`). The console creates them, shows each one once, stores only a hash, and allows several labeled keys per merchant with instant revoke.
- **Invoices API.** `POST /api/v1/invoices` takes a Bearer key, a decimal amount, a currency symbol and an optional `order_id`. It creates the invoice on-chain through the signer key and returns `{id, url, status, ...}`. A repeated `order_id` while its invoice is still Open and unexpired returns that same invoice. `GET /api/v1/invoices/:id` reads live status from the chain. Requests are rate-limited per gateway.
- **Webhooks.** There is one URL per gateway, signed with HMAC-SHA256 using a `whsec_` secret. The events are `invoice.paying`, `invoice.paid`, `invoice.returned` and `invoice.expired`. Failed deliveries are retried with backoff.
- **Allowed origins** per gateway. They gate the widget's postMessage target and the redirect `return_url`.
- **Checkout widget.** `/js/v1/gateflow.js` provides `Gateflow.open(id, { onStatus })`, which shows `/pay/<id>?embed=1` in a modal iframe and posts status events meant for UI only. A redirect fallback with `return_url` is included.
- **Embed mode** on the checkout page hides the page chrome. Inside the iframe, the NEAR wallet path continues in a new tab.
- **The relay's key guard** accepts `AddKey` and `DeleteKey` only for the signer key with exactly that permission.
- **The testnet deploy** serves as the sandbox.
- **A runnable example**, `examples/shop/`.

## Capabilities

### New Capabilities

- `merchant-api`: API keys, the invoices HTTP API, the invoice signer key and webhooks.
- `checkout-widget`: the embeddable script, the modal, postMessage events, the redirect fallback and allowed origins.

### Modified Capabilities

- `merchant-accounts`: a session still changes nothing on-chain by itself, but invoices created through the API are signed by the scoped signer key the merchant added.
- `merchant-console`: Settings gains a Developers section (Enable API, API keys, webhook URL and secret, allowed origins).
- `payer-checkout`: embed mode, and the NEAR wallet opening in a new tab when embedded.

## Impact

- **Relay:** a new `/api/v1/*` route table, new DB tables (API keys, API invoices, webhook config and deliveries), webhook polling in the watcher, the key-action guard in `delegate.ts`, a new `INVOICE_SIGNER_KEY` setting, and `/api` excluded from the static SPA fallback.
- **Web:** a Settings Developers section, embed mode in `Checkout.tsx`, and `web/public/js/v1/gateflow.js`.
- **Contract:** no change. `create_invoice` takes no deposit, so a FunctionCall key can sign it in a NEP-366 delegate action.
- **Trust:** funds stay non-custodial. A leaked signer key can only create invoices that pay the merchant, which drains fuel at the rate-limited pace.
- **Out of scope:** reusable products or price links (they need a contract redeploy), shop-held signing keys, framework plugins, a webhook event log UI, and list or cancel endpoints.
