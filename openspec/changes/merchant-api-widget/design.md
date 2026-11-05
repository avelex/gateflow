# Design

## Context

See proposal.md for motivation. Relevant current state:

- `create_invoice` is owner-only and not payable (`contract/src/invoices.rs`). The console signs it as a NEP-366 delegate action with the passkey-derived key, and the relay sponsors it through `POST /console/relay` after `refusal()` in `relay/src/delegate.ts`. Today `refusal()` requires receiver = Gateflow and function calls only.
- The relay is one Node process with SQLite (`relay/src/db.ts`), a route table per area (`consoleRoutes`, `chatRoutes`, `checkoutRoutes`), and a 15 s watcher loop (`relay/src/watcher.ts`) that polls 1Click quotes.
- `relay/src/static.ts` serves `web/dist` with an SPA fallback, except for `/console` and `/checkout`. No frame headers are set, so `/pay/<id>` can already be framed.
- `gateflow.near` has no upgrade path. This design changes no contract code.

## Goals / Non-Goals

**Goals:**
- A shop integrates with only HTTP, a secret and a script tag.
- The operator's new power is limited to "create invoices that pay the merchant".
- The design reuses the existing delegate-action, watcher and checkout code paths.

**Non-Goals:**
- Webhooks for invoices created in the console. Only API-created invoices are tracked.
- Any multi-process relay. In-memory rate limits and per-account queues assume a single instance.
- An SDK package. The raw HTTP API and the example cover it.

## Decisions

### D1. The relay signs `create_invoice` as the merchant through a delegate action
The relay builds a `DelegateAction` with sender = merchant account, receiver = Gateflow and one `create_invoice` call. It signs it with the signer key (`signDelegate`) and submits it with the operator account, the same way `POST /console/relay` works. The operator pays gas, the merchant account spends nothing, and the invoice id comes from the transaction's return value.

*Alternatives considered:* a direct transaction signed by the FunctionCall key would spend the merchant account's balance and its key allowance on gas. A shop-held key (the shop signs) is safer but rules out integrations in curl or PHP. That option could be added later without breaking the API.

### D2. One shared signer key (`INVOICE_SIGNER_KEY`)
A single ed25519 secret lives in the relay config. Its public key is shown to the console so the console can build the `AddKey`. "Enabled" means `view_access_key(merchant, signer_pub)` returns a key.

*Ceiling:* a leak lets someone spam invoices for every enabled merchant, but cannot redirect funds. Upgrade path: per-merchant keys, encrypted at rest.

### D3. Key-action guard in `refusal()`
A new branch applies when `receiverId == senderId == session account`. It allows exactly one action:
- `AddKey(signer_pub, FunctionCall{allowance: SIGNER_ALLOWANCE, receiver: gateflow, methods: ["create_invoice"]})`, or
- `DeleteKey(signer_pub)`.

`readAction` already parses `AddKey` and `DeleteKey`. It now returns their fields instead of `other`. Everything else stays refused.

### D4. Nonces are serialized per merchant
Concurrent API calls from one merchant share the signer key's nonce, so creations for one account run through a promise queue: read the nonce, sign, send, await. Different merchants run in parallel. An `InvalidNonce` error retries once with a fresh nonce.

### D5. Data model (SQLite, same file)
- `api_keys(hash PK, email, label, last4, created_at, revoked_at)`.
- `gateway_dev(gateway PK, webhook_url, webhook_secret, origins JSON)`.
- `api_invoices(invoice PK, gateway, order_id, status, expires_at_ms)`, indexed on `(gateway, order_id)`. Order deduplication is a lookup on this table.
- `webhook_deliveries(id PK, invoice, event, body, attempts, next_at_ms, done)`.

### D6. Webhooks run off the watcher tick
The watcher tick gains two steps:
1. For each `api_invoices` row that is not final, it calls `get_invoice`. On a status change, or on passing expiry while Open, it updates the row and queues one delivery per event.
2. It POSTs the due deliveries. Only the oldest undelivered event of each invoice is sent, which keeps events in transition order. The timeout is 10 s (`AbortSignal.timeout`), and the backoff schedule is `[1m, 5m, 30m, 2h, 12h]`.

The signature is `t=<s>,v1=HMAC(secret, "<t>.<body>")`, the Stripe-compatible form, so existing verification code examples apply.

*Alternative considered:* contract event indexing. It needs no polling, but there is no indexer in the stack, and polling non-final API invoices is cheap.

### D7. Origin handling without trusting the frame
`Gateflow.open` passes `&parent=<location.origin>` into the iframe URL. The page reads the gateway's `origins` from `GET /checkout/invoice` (they are public, not secret). If `parent` is on the list, the page calls `postMessage(msg, parent)`. The browser's `targetOrigin` check makes a lying `parent` deliver nothing. `return_url` is checked against the same list. The script accepts messages only when `event.origin` is the relay origin and `event.source` is its own iframe.

### D8. Widget as a static file
`web/public/js/v1/gateflow.js` is plain ES5-compatible JS with no build step. Vite copies it to `dist`, and `static.ts` serves it. The modal and its styles are created from JS inside a shadow root, so shop CSS cannot break it.

### D9. API surface
`/api/v1/*` gets its own route table. It is excluded from the static fallback and has no CORS: it is server-to-server, and keys must not reach browsers. Amounts are converted with token decimals from `ft_metadata`. The currency is the display symbol from the existing "Token display symbol" rule. The rate limit is a sliding window of 60 per minute per gateway, kept in memory.

## Risks / Trade-offs

- [Operator now signs on the merchant's behalf] → The scope is `create_invoice` only, the guard rejects anything wider, the merchant can revoke it with one passkey prompt, and the README states the trust change.
- [Spam drains fuel] → The rate limit, the fuel warning in Settings, and key revoke.
- [Webhook SSRF into the relay's network] → Accept only `https:` URLs. Refuse `localhost` and private, link-local or loopback IP literals and resolved addresses at send time.
- [`FunctionCall` keys and delegate actions] → nearcore allows a FunctionCall key to sign a delegate action with one zero-deposit call. A testnet spike confirms this and how the key allowance behaves before any other work (task 1).
- [Wallet-selector inside the iframe] → In embed mode the NEAR path opens a new tab, and cross-chain stays in the frame.
- [In-memory rate limit and queues reset on restart] → Acceptable for a single instance. The `ponytail:` comment names the ceiling.

## Migration Plan

1. Generate the signer key pair and set `INVOICE_SIGNER_KEY` on the testnet relay, then on mainnet.
2. The DB tables are created with `CREATE TABLE IF NOT EXISTS`, as today.
3. No merchant is affected until they press Enable API.
4. Rollback: remove the `/api/v1` routes. Merchants' signer keys stay harmless, and Disable API still works because the guard stays in place.

## Open Questions

- The `SIGNER_ALLOWANCE` value (a fixed small amount or none) depends on the spike in task 1. It changes only one constant in the guard and the console.
