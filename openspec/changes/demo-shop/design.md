# Design

## Context

`examples/shop/` has two files today. `server.mjs` uses Node built-ins and needs Node 24 or later for `import.meta.main`. It serves `index.html` with `GATEFLOW_URL` and `PRICE` substituted, offers `POST /checkout` (one invoice, `order_<Date.now()>`) and `POST /webhook` (it verifies the signature and logs). It exports `verifySignature`. The widget's `onStatus` already emits `closed` when the buyer dismisses the modal. The API dedupes a repeated `order_id` while its invoice is Open, and webhooks for one invoice arrive in transition order but may repeat after retries (see `merchant-api` spec). See proposal.md for the motivation.

## Goals / Non-Goals

**Goals:**
- Two files, no dependencies, no build step, with one command to run.
- The shop's server, not the browser, is visibly the source of truth for an order's status.

**Non-Goals:**
- Production patterns such as a DB, auth, inventory or tax.
- Calling `GET /api/v1/invoices/<id>` to reconcile. The demo relies on the webhook arriving.

## Decisions

- **Money in integer micro-USDC.** The catalog stores prices as integers (`10000` = 0.01). Totals are summed as integers and formatted to a decimal string only for the API and the page. This avoids float drift on items like 0.005. The alternative, decimal strings everywhere, needs a parser on both ends for no gain.
- **Catalog on the server, ids from the page.** `POST /checkout` takes `{items: [{id, qty}]}`, rejects unknown ids, quantities that are not positive integers (each capped at 10) and an empty cart, and computes the total. The page fetches `GET /catalog` to render, so prices are defined once.
- **One order, one invoice.** The order id is `ord_<run>_<counter>`, where `<run>` is the server's start time in base 36, sent as `order_id`. The run prefix matters: a bare counter restarts at 1, and the API's `order_id` dedup would hand back an older Open invoice with a different amount. If the modal is closed, the page reopens `Gateflow.open` with the stored invoice id. It does not create a new invoice, and repeated clicks stay on the same invoice. Once an order is `expired`, "Try again" starts a new order from the same cart. This is simpler than re-invoicing an old order.
- **Status changes only through the webhook.** Order states are `pending -> paying -> paid`, or `pending | paying -> expired | returned`. The webhook handler applies an event only when it moves the order forward, so a repeated or late event is a no-op. A seen `(invoice, event)` set is not needed because forward-only transitions are already idempotent. `onStatus` drives only the modal-closed prompt and never writes order state.
- **Polling over SSE.** The order page polls `GET /orders/<id>` and the merchant strip polls `GET /events` once a second. SSE would also fit in Node built-ins, but polling needs no connection bookkeeping and the demo has one viewer.
- **One HTML file, views by path.** The server serves `index.html` for `/` and `/order/<id>`. The script picks the storefront or the order view from `location.pathname`. The alternative, a second HTML file, duplicates head, styles and widget loading.
- **Webhook log.** This is an in-memory ring of the last 50 entries `{at, event, order_id, status, sig_ok}`. Bad signatures are logged too (`sig_ok: false`) and still answered with 400, so a misconfigured secret shows on screen instead of failing silently.
- **Pure logic is exported and tested.** `verifySignature`, `priceCart` and `applyEvent` are exported. `server.test.mjs` covers them with `node --test`, and `npm`/`package.json` are not needed.

## Risks / Trade-offs

- **[Risk]** A 0.01 USDC cross-chain payment falls below the bridge minimum. **Mitigation:** rehearse first (task 1). If the route refuses, demo the NEAR wallet path, or keep the cap and note it.
- **[Risk]** The tunnel URL changes between runs, which breaks Allowed origins and the webhook URL. **Mitigation:** the startup log prints both values to paste. A fixed tunnel name is recommended in the usage comment.
- **[Trade-off]** A server restart loses orders. A webhook for an unknown order is logged and answered 200, so the relay stops retrying.
- **[Trade-off]** With no reconcile call, an order stays `pending` if the webhook is misconfigured. The merchant strip makes that visible.

## Migration Plan

`AMOUNT` and `CURRENCY` are removed. Anyone who runs the old command gets the catalog instead. The `mainnet-launch` 2.4 wording is updated in the same change. Rollback is a git revert of two files.
