# Tasks

> **For agentic workers:** use superpowers:executing-plans to work through these tasks in order. Each task is a checkbox.

**Goal:** `examples/shop/` is a demo storefront. It has a four-item catalog priced at most 0.01 USDC, a cart and server-priced checkout. An order page flips to Paid when the signed webhook arrives, and a merchant strip shows each webhook.

**Architecture:** two files, `server.mjs` and `index.html`, plus `server.test.mjs`. State lives in memory. The page polls the server once a second. See `design.md`.

**Tech Stack:** Node 24 or later, using built-ins only (`node:http`, `node:crypto`, `node:test`). The page is plain HTML and JS.

## Global Constraints

- Add no dependency, no `package.json` and no build step.
- Tests run with `node --test examples/shop/server.test.mjs` (Node 26 treats a bare directory argument as a script).
- Currency is always `USDC`. Prices are integer micro-USDC, and every item costs at most `10000` (0.01).
- `GATEFLOW_URL`, `GATEFLOW_KEY`, `GATEFLOW_WEBHOOK_SECRET` and `PORT` stay. `AMOUNT` and `CURRENCY` are removed.
- Order status changes only in the webhook handler, through `applyEvent`.
- Commit after each group with a short conventional message, such as `feat(examples): demo shop catalog`.

## 0. Rehearsal

- [ ] 0.1 With the current shop, run `AMOUNT=0.01 CURRENCY=USDC` behind a tunnel, create an invoice and pay it from Base.
  - Record in `design.md` under Risks whether the 1Click route accepts 0.01 USDC, and what the payer paid in total.
  - If the route refuses, record that the demo uses the NEAR wallet path.
  - Verify: the outcome and the invoice id are written in `design.md`.

## 1. Server logic

- [x] 1.1 In `server.mjs`, add `CATALOG` (four items `{id, name, emoji, price}` with `price` in micro-USDC, each at most 10000) and the exported `priceCart(items)`.
  - `priceCart` returns `{lines, total}` with `total` as a decimal string (`"0.025"`).
  - It throws on an unknown id, a quantity that is not an integer from 1 to 10, or an empty cart.
  - Create `server.test.mjs` with tests `price_sums_micro_units` (0.01 + 0.005 = `"0.015"`), `price_rejects_unknown`, `price_rejects_bad_qty` and `price_rejects_empty`.
  - Verify: `node --test examples/shop/server.test.mjs` passes.
- [x] 1.2 Add the exported `applyEvent(order, event)`, which returns the new status or `null` when the event does not move the order forward.
  - The order is `pending -> paying -> paid`, plus `pending|paying -> expired|returned`.
  - Add tests `event_moves_forward`, `event_repeat_is_noop` (a second `invoice.paid` returns `null`) and `event_late_paying_after_paid_is_noop`.
  - Verify: `node --test examples/shop/server.test.mjs` passes.
- [x] 1.3 Add the routes:
  - `GET /` and `GET /order/<id>` serve `index.html`.
  - `GET /catalog` answers `{items}` with prices as decimal strings.
  - `POST /checkout` takes `{items}`, runs `priceCart` (400 on an error), stores `orders[ord_<n>] = {id, lines, total, status: "pending", invoice}` and creates the invoice with `order_id = ord_<n>`. It answers `{order, invoice}`, or relays the API error status and body.
  - `GET /orders/<id>` answers the order, or 404.
  - `GET /events` answers the last 50 webhook log entries, newest first.
  - Verify: run the server with a dummy key and secret, then check with `curl` that `GET /catalog` lists four items and that `POST /checkout` with `{"items":[{"id":"nope","qty":1}]}` answers 400.
- [x] 1.4 In `POST /webhook`, verify the signature and push `{at, event, order_id, status, sig_ok}` to the log (a ring of 50). Answer 400 on a bad signature, but still log it.
  - On a valid event, apply `applyEvent` to the matching order. An unknown order is logged and answered 200.
  - Update the usage comment at the top. On startup, log the shop URL plus the two values to paste into the console: the Allowed origin, and the webhook URL `<origin>/webhook`.
  - Add test `webhook_bad_sig_logged` by exporting a `handleWebhook(headers, body)` that the route calls.
  - Verify: `node --test examples/shop/server.test.mjs` passes.

## 2. Page

- [x] 2.1 Build the storefront view in `index.html`:
  - a product grid from `GET /catalog` (emoji art, name, price, Add);
  - a cart panel with quantity controls and the total, kept in `localStorage` (reads and writes inside try/catch);
  - a "Pay with crypto" button that posts `/checkout`, then calls `Gateflow.open(invoice.id)` and navigates to `/order/<id>` when the modal closes or the payment finishes.

  Keep the layout usable at 375 px width. Verify: in a browser at 375 px and at 1280 px, adding two items shows the correct total, and Pay opens the modal.
- [x] 2.2 Build the order view at `/order/<id>`:
  - lines, total and a status badge, polled from `GET /orders/<id>` every second;
  - text "confirmed by webhook at <time>" once Paid;
  - while the order is `pending`, a "Reopen checkout" button that calls `Gateflow.open` with the stored invoice id;
  - once the order is `expired`, a "Try again" button that starts a new checkout from the same cart;
  - clear the cart once the order is Paid.

  Verify: post a signed `invoice.paid` with `curl` and a test secret to `/webhook`, and check that the badge flips to Paid within 2 s.
- [x] 2.3 Add the merchant strip, a collapsible panel on both views. It polls `GET /events` and shows time, event, order and a sig ok/bad mark. Verify: posting one good and one bad signature with `curl` shows two rows, one of them marked bad.

## 3. Docs

- [x] 3.1 Update the `examples/shop/` line in `README.md`: a demo storefront with a cart, order page and webhook log, using Node built-ins, a run command, and the note that prices are at most 0.01 USDC. Verify: the documented command starts the shop.
- [x] 3.2 Reword `openspec/changes/mainnet-launch/tasks.md` task 2.4 from `CURRENCY=USDC AMOUNT=0.10` to "buy one item through `examples/shop`", keeping the rest of the check. Verify: `grep AMOUNT openspec/changes/mainnet-launch/tasks.md` prints nothing.

## 4. Live check

- [ ] 4.1 Run the shop behind a tunnel against the relay, with the tunnel origin in Allowed origins and the webhook URL set. Buy two items and pay through the route chosen in 0.1.
  - Verify: the order page goes `pending -> paying -> paid`, the strip shows `invoice.paying` and `invoice.paid` with sig ok, and the cart is empty afterwards.
  - Record the invoice id in this task.

## Workflow follow-up

- Archive the change after review.
