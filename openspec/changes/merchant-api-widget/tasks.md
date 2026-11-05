# Tasks

> **For agentic workers:** use superpowers:subagent-driven-development or superpowers:executing-plans to work through these tasks in order. Each task is a checkbox.

**Goal:** a shop creates invoices with `POST /api/v1/invoices` and a Bearer key, opens checkout with `Gateflow.open(id)`, and learns the outcome from signed webhooks. The contract does not change.

**Architecture:**
- The relay signs `create_invoice` as the merchant in a NEP-366 delegate action, using one operator-held FunctionCall key (`INVOICE_SIGNER_KEY`). The merchant adds that key once with a passkey.
- API state, webhook config and deliveries live in the relay's SQLite DB. The watcher tick polls non-final API invoices and delivers webhooks.
- The widget is a static script that frames `/pay/<id>?embed=1` and relays postMessage events.

**Tech Stack:** relay on Node 26 with `node:test` and SQLite through `db.ts`. Web on React, Vite and vitest. The widget is plain JS with no build step.

**Spec:** `specs/merchant-api/spec.md`, `specs/checkout-widget/spec.md`, `specs/merchant-accounts/spec.md`, `specs/merchant-console/spec.md`, `specs/payer-checkout/spec.md`, and `design.md` in this change.

## Global Constraints

- Relay tests: `cd relay && npm test`. Web: `cd web && npm test && npm run build`. Every task leaves all of these green.
- Add no new npm dependency. Use `node:crypto` for hashes, HMAC and random bytes.
- No contract change.
- Commit after each task with a short conventional message, such as `feat(relay): api keys`.
- Exact values:
  - key prefixes `gf_live_` (mainnet) and `gf_test_` (testnet), then 32 random bytes in base62
  - webhook secret prefix `whsec_`
  - signature header `Gateflow-Signature: t=<unix s>,v1=<hex>`
  - rate limit 60 per gateway per minute
  - default `expires_in_sec` 1800
  - retry delays 60, 300, 1800, 7200 and 43200 s
  - delivery timeout 10 s
  - widget path `/js/v1/gateflow.js`
- Status values: `open`, `paying`, `paid`, `returned`, `expired` (the widget also uses `closed`).
- The network is testnet when `cfg.gateflow` ends with `.testnet`.

## Review Focus

1. **Two concurrent creations for one merchant.** Both must succeed with distinct invoice ids, with no `InvalidNonce` error surfacing. Test `api_create_concurrent` in 3.2 covers this.
2. **The shop retries after a timeout while the first create is still in flight.** The second call must wait for the first and return the same invoice, not create a second one. Run dedup inside the same per-merchant lock (3.2, test `api_dedupe_inflight`).
3. **A webhook URL that resolves to a private address** (for example `https://10.0.0.5/`, or a DNS name pointing at `127.0.0.1`) must never be POSTed to. Tests `webhook_refuses_private` and `webhook_refuses_resolved_private` in 4.2 cover this.
4. **The merchant switches a token off after creating keys.** `POST` with that currency must give 422. Test `api_create_token_off` in 3.2 covers this.
5. **The embedded page receives `parent=https://evil.example`** while that origin is not on the list. It must post nothing. Test `allowed_parent` in 5.1 covers this.

## 0. Spike

- [ ] 0.1 On testnet, add a FunctionCall key (receiver = the Gateflow contract, methods `[create_invoice]`) to a test merchant account. Sign a `create_invoice` delegate action with that key and relay it through the operator.
  - Record in `design.md` whether this succeeds, and whether the key's allowance decreases.
  - Set `SIGNER_ALLOWANCE` to `null` (unlimited) if the allowance is untouched. Otherwise set it to the smallest value that covers about 10 000 calls.
  - Resolve design.md's Open Question.
  - Verify: the transaction hash is in design.md, and the invoice exists through `get_invoice`.

## 1. API keys

- [x] 1.1 Add `headers: Record<string, string>` to `Req` in `relay/src/types.ts`, with lower-cased names filled in `relay/src/main.ts`.
  - Add `INVOICE_SIGNER_KEY` to `Config` as `invoiceSigner?: string`.
  - Verify: existing tests pass, and a new test in `relay/src/shell.test.ts` shows a handler reading `req.headers.authorization`.
- [x] 1.2 Create `relay/src/api.ts` with pure helpers:
  - `newApiKey(testnet: boolean): string`
  - `keyHash(key: string): string` (sha256 hex)
  - `newWebhookSecret(): string`

  In `db.ts`, add the table `api_keys(hash PK, email, label, last4, created_at, revoked_at)` and the methods `addApiKey`, `apiKeys(email)`, `revokeApiKey(email, hash)` and `merchantByKeyHash(hash)` (which skips revoked keys).

  Tests in `relay/src/api.test.ts`:
  - `api_key_format`: matches `/^gf_test_[0-9A-Za-z]{43}$/`.
  - `key_hash_stable`.
  - `revoked_key_not_found`.
- [x] 1.3 Add console routes:
  - `GET /console/api-keys` returns `[{id: hash.slice(0,12), label, last4, createdAt}]`.
  - `POST /console/api-keys {label}` returns `{key}`, once.
  - `DELETE /console/api-keys?id=` revokes the key.

  These routes require a session. Tests `api_keys_list_hides_secret` and `api_keys_other_merchant` (one merchant cannot revoke another's key) must pass.

## 2. Signer key guard

- [x] 2.1 In `relay/src/delegate.ts`, make `readAction` return `{kind: "addKey", publicKey, permission}` and `{kind: "deleteKey", publicKey}`. `publicKey` is in `ed25519:<base58>` form, and `permission` is `{fullAccess: true}` or `{allowance, receiver, methods}`.

  Extend `refusal(d, sessionAccount, gateflow, signerPub?)`. When `d.receiverId === sessionAccount`, allow exactly one action:
  - `addKey(signerPub, {allowance: SIGNER_ALLOWANCE, receiver: gateflow, methods: ["create_invoice"]})`, or
  - `deleteKey(signerPub)`.

  Refuse anything else.

  Tests in `relay/src/delegate.test.ts`:
  - `guard_allows_signer_add`
  - `guard_allows_signer_delete`
  - `guard_refuses_full_access`
  - `guard_refuses_extra_method`
  - `guard_refuses_other_key_delete`
  - `guard_refuses_two_actions`
- [x] 2.2 In `POST /console/relay`, pass `signerPub` and use executor = sender for key actions.
  - Add `GET /console/dev`, returning `{enabled, signerPublicKey, allowance, webhookUrl, origins}`. `enabled` comes from `near.accessKey(account, signerPub)`.
  - Test `dev_enabled_after_add_key` uses the fake Near from `testing.ts`.

## 3. Invoices API

- [x] 3.1 Add pure helpers in `api.ts`:
  - `toRaw(amount: string, decimals: number): bigint`, which throws on 0, a negative amount, more decimals than the token has, or a non-decimal string.
  - `fromRaw(raw: bigint, decimals): string`.
  - `apiStatus(inv: {status, expires_at...}, nowMs): "open" | "paying" | "paid" | "returned" | "expired"`.
  - `invoiceObject(...)`.

  Tests:
  - `to_raw_usdc`: `toRaw("10.00", 6) === 10_000_000n`.
  - `to_raw_rejects` covers `"0"`, `"1.1234567"` at 6 decimals, and `"abc"`.
  - `api_status_expired`.
- [x] 3.2 Add the `apiRoutes` table with `POST /api/v1/invoices` and `GET /api/v1/invoices/:id`. Exclude `/api` from `serveStatic`.

  Authentication uses the Bearer key through `merchantByKeyHash`, answering 401 otherwise.

  For a create request:
  1. Answer 409 "API is not enabled" when the signer key is missing.
  2. Validate the input and answer 422 with `{error, field}`.
  3. Inside `withLock(account)`, do the dedup lookup on `api_invoices(gateway, order_id)` among Open, unexpired rows, which answers 200.
  4. Otherwise sign the delegate with `signDelegate` and the signer secret, using the nonce from `accessKey`. Send it through `near.send`, and retry once on `InvalidNonce`.
  5. Insert the `api_invoices` row and answer 201.

  The rate limit is a sliding window in memory (`ponytail:` comment naming the single-instance ceiling) and answers 429 with `Retry-After`.

  Tests:
  - `api_auth_missing`
  - `api_create_ok` (asserts the delegate args and memo = `order_id`)
  - `api_create_not_enabled`
  - `api_create_token_off`
  - `api_dedupe`
  - `api_dedupe_inflight`
  - `api_dedupe_after_expiry`
  - `api_create_concurrent`
  - `api_rate_limit`
  - `api_get_other_gateway_404`
  - `api_get_paid`

## 4. Webhooks

- [x] 4.1 Add the tables `gateway_dev(gateway PK, webhook_url, webhook_secret, origins)` and `webhook_deliveries(id PK, invoice, event, body, attempts, next_at_ms, done)`.

  Add console routes:
  - `PUT /console/webhook {url}` requires `https:`, returns a fresh secret once, and clears the URL on `null`.
  - `POST /console/webhook/secret` rolls the secret.
  - `PUT /console/origins {origins}` validates each entry as `https://host[:port]`, except that `http://localhost[:port]` is allowed on testnet.

  Tests:
  - `webhook_requires_https`
  - `webhook_secret_once`
  - `origins_validated`
- [x] 4.2 Add pure helpers in `api.ts`:
  - `signature(secret, t, body): string`. Test `signature_vector` against a fixed HMAC-SHA256 vector.
  - `retryAt(attempts, nowMs): number | undefined`. It returns undefined after 5 retries. Test `retry_schedule`.
  - `isPrivateAddress(ip): boolean`. It covers loopback, RFC 1918, link-local, `::1` and `fc00::/7`.

  Add `deliver(deps)`, which sends the oldest undelivered event per invoice. It resolves the host with `node:dns` `lookup` and refuses private addresses. It uses a 10 s `AbortSignal.timeout`, and any 2xx answer marks the delivery done.

  Tests:
  - `deliver_order` (`paid` is not sent before `paying` is done)
  - `deliver_retry_then_ok`
  - `webhook_refuses_private`
  - `webhook_refuses_resolved_private`
- [x] 4.3 In `watcher.ts` `tick`, call `get_invoice` for each non-final `api_invoices` row. On a status change, or on passing expiry while Open, update the row and queue the events (both `paying` and `paid` when a tick skips straight to paid), then call `deliver`.

  Tests:
  - `watch_queues_paying_paid`
  - `watch_expired_once`
  - `watch_no_webhook_url_no_queue`

## 5. Checkout embed

- [ ] 5.1 Make `GET /checkout/invoice` also return `origins: string[]` for the invoice's gateway.

  In `web/src/checkout/logic.ts`, add:
  - `allowedParent(origins, parent): boolean` (exact origin match)
  - `returnLink(url, origins, id, status): string | undefined`
  - `widgetStatus(inv, nowMs)`, which maps to the widget statuses.

  Tests:
  - `allowed_parent`
  - `return_link_adds_params`
  - `return_link_refuses_unlisted`
- [ ] 5.2 In `Checkout.tsx`, `?embed=1` hides the header and footer and uses a transparent background. On each `widgetStatus` change, post `{source: "gateflow", invoice, status}` to `parent` with targetOrigin = the `parent` query parameter, only when `allowedParent` is true.
  - When embedded, picking NEAR shows the "Open in new tab" button (`window.open('/pay/<id>')`) in place of `NearPay`.
  - A valid `return_url` shows "Back to shop" in final states.
  - Verify with `npm run build`, then load `/pay/<id>?embed=1&parent=http://localhost:8080` in an iframe on a test page and see the status messages in the console.

## 6. Widget script

- [ ] 6.1 Create `web/public/js/v1/gateflow.js`, an IIFE that defines `window.Gateflow = {open(id, {onStatus}), close()}`.
  - It works out the relay origin from its own `script.src`.
  - The modal lives in a shadow root on `document.body`: a backdrop, a close button, and an iframe `src=<relay>/pay/<id>?embed=1&parent=<location.origin>`. It is full-screen under 480 px.
  - Accept a message only when `e.origin === relay && e.source === iframe.contentWindow && e.data.source === "gateflow"`.
  - `close()` emits `closed` and removes the modal.

  Expose the message gate as `Gateflow._accepts(e, relay, frameWindow): boolean`. Test `web/src/widget.test.ts` loads the script with stub `window`, `document` and `currentScript` objects (no jsdom, since it is not installed):
  - `widget_ignores_foreign_origin`
  - `widget_ignores_foreign_source`
  - `widget_accepts_own_frame`

  Verify open, close and status by hand on the 8.1 example page, including at a 375 px width.

## 7. Console Developers section

- [ ] 7.1 In `web/src/console/Settings.tsx`, add a Developers section driven by `GET /console/dev`.
  - When disabled, show the "Enable API" button. It acquires the passkey key and signs an `AddKey` delegate with receiver = own account, through the existing `signAndRelay` path extended to key actions.
  - When enabled, show:
    - the API key list with create (key shown once, with copy) and revoke
    - the webhook URL with its secret shown once and a Roll secret action
    - the allowed origins editor
    - the curl and script snippets, using `location.origin`
    - "Disable API", which signs `DeleteKey`
  - Test in `web/src/console/logic.test.ts`: `snippets_use_origin`.
  - Verify by hand on testnet that Enable, then create key, then curl creates an invoice.

## 8. Example and docs

- [ ] 8.1 Create `examples/shop/server.mjs` and `examples/shop/index.html`, using only Node built-ins.
  - The server's `POST /checkout` creates an invoice through `GATEFLOW_KEY`. It runs a webhook receiver that verifies `Gateflow-Signature` and logs the events.
  - The page has a Buy button that calls `Gateflow.open`.
  - Add a README section "Accept payments on your site" with curl, the script tag, signature verification, and the trust note on the signer key.
  - Verify with a testnet run: buy for 1 USDC from Base, see `invoice.paying` and `invoice.paid` logged, and the modal shows paid.

## Workflow follow-up

- Archive after the testnet run in 8.1 passes and review is complete.
- Mainnet: set `INVOICE_SIGNER_KEY` after `mainnet-launch` is archived.
