# Proposal

## Why

`examples/shop/` is the page we show when we demo Gateflow live. Today it has one product with a price from env and a single Buy button. After payment it shows a text line from `onStatus` and logs the webhook to the terminal. Nothing on screen shows the shop's server learning that it was paid. That moment is the point of the demo.

## What Changes

- **Storefront.** A grid of four hardcoded products, each priced at most 0.01 USDC, and a cart kept in `localStorage`.
- **Server-priced checkout.** `POST /checkout` takes product ids and quantities, computes the total from the server's catalog, stores an order in memory and creates one invoice with the order id as `order_id`.
- **Order page.** `/order/<id>` polls the shop server and shows `pending`, `paying`, `paid` or `expired`. The status changes only when a signed webhook arrives, never from `onStatus`. If the buyer closes the modal, the page offers to reopen checkout for the same invoice.
- **Merchant strip.** A panel lists the webhooks the server received (time, event, order, signature ok), so the audience sees the backend side.
- **Webhook handling.** It verifies the signature, ignores repeated deliveries and updates the order.
- **BREAKING (example only).** The `AMOUNT` and `CURRENCY` env vars are removed. The currency is always USDC, because at most 0.01 per item is only cheap in USDC.
- The README example line is updated, and `mainnet-launch` task 2.4 is reworded to "buy one item" instead of `AMOUNT=0.10`.

## Capabilities

### New Capabilities

None. The example is demo material, not product behavior, so the change sets `skip_specs: true`.

### Modified Capabilities

None. The relay, widget and API stay unchanged.

## Impact

- **Code.** `examples/shop/server.mjs` and `examples/shop/index.html` keep using Node built-ins only, with no build step. Orders and the webhook log live in memory and are lost on restart.
- **Docs.** The README line about `examples/shop/` is updated.
- **Other change.** The wording of `mainnet-launch/tasks.md` task 2.4 changes.
- **Demo setup.** It runs on the presenter's laptop behind an HTTPS tunnel. The tunnel origin must be in Allowed origins, and the webhook URL must point at `<tunnel>/webhook`.
- **Risk.** A 0.01 USDC payment from another chain may fall below the Intents/1Click minimum or be eaten by fees. Nothing in this repo enforces a minimum, so a rehearsal must confirm the route. The NEAR wallet path is unaffected.
- **Out of scope.** Persistence, a currency picker, the redirect fallback, product images and multi-user or hosted demos.
