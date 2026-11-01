# Contract Invoices and Views Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. OpenSpec tracks only the `- [ ] N.M` lines; the numbered steps under each task are its TDD cycle and are not tracked separately.

**Goal:** Give the Gateflow contract on-chain invoices, a token allowlist with one token-free gateway per merchant, and paginated invoice and payment views. Make the relay quote cross-chain payments by invoice.

**Architecture:**
- Payments record their own `token` (the `ft_on_transfer` predecessor, checked against an `IterableSet` allowlist), and `close`/`retry` transfer it.
- Invoices live in a `LookupMap<InvoiceId, Invoice>`. Per-gateway order is kept in composite-key maps `(GatewayId, u32) -> id`, with counters on `Gateway`.
- `ft_on_transfer` validates an optional `invoice` before opening the payment. Only an accepted payment links to the invoice, and `close` moves the invoice to Paid or Returned.
- The relay reads `get_invoice` instead of `get_gateway`.

**Tech Stack:** Rust near-sdk 5 (`contract/`, unit tests with `unit-testing`), TypeScript on Node built-ins with `node --test` (`relay/`).

**Spec:**
- `openspec/changes/contract-invoices-views/specs/{invoices,merchant-gateways,payment-clearing,checkout-relay}/spec.md`
- `openspec/changes/contract-invoices-views/design.md`

## Global Constraints

- **Types:** `InvoiceId = u64`. `InvoiceStatus = Open | Paying | Paid | Returned` (JSON: the variant name).
- **Invoice fields:** `{gateway, token, amount: U128, expires_at_sec: u64, memo: Option<String>, status, payment: Option<PaymentId>}`.
- **Gateway fields:** `{owner, payout_to, policy, fuel, invoices: u32, payments: u32}`. No `token`.
- **Payment fields** gain `token: AccountId` and `invoice: Option<InvoiceId>`. `PayMsg` gains `invoice: Option<InvoiceId>`.
- **Invoice limits:**
  - `expires_in_sec` must be in `60..=2_592_000`.
  - `memo` must be at most 140 bytes.
  - `amount` must be greater than 0.
  - Expired means `expires_at_sec <= now_sec()`.
  - Page size is `min(limit, 100)`.
- **Error strings (exact):** "token not accepted", "unknown invoice", "invoice is for another gateway", "invoice is not open", "invoice expired", "wrong token for this invoice", "amount does not match the invoice", "invalid expiry", "memo too long", "zero amount", "not the gateway owner".
- **Log line:** `INVOICE id={id} gateway={gateway} token={token} amount={amount}`.
- **Unchanged:** payments without `ref` and without `invoice` behave as before, apart from the allowlist check that replaces the gateway token check. The enclave is not touched.
- **Relay:** Node built-ins only. The relay quote refuses (409) when the invoice is not `Open`, or when `expires_at_sec * 1000 <= Date.now() + QUOTE_DEADLINE_MS`.
- **Deploy:** fresh deployment only, because the state layout changes.
- **Commits:** short conventional style (`feat(contract): …`), one per task.

## Review Focus

- **Duplicate `ref` naming a valid Open invoice:** the payment is refunded and the invoice stays Open with no `payment`. Test `duplicate_ref_leaves_invoice_open` (2.2).
- **`reclaim` of a stuck invoice payment:** the invoice becomes Returned, not left Paying. Test `reclaim_marks_invoice_returned` (2.2).
- **Payment exactly at `expires_at_sec`:** rejected as expired. Test `payment_at_expiry_rejected` (2.2).
- **Token removed after the invoice was created:** new payments fail "token not accepted", and a pending payment still closes in its own token. Tests `removed_token_rejects_new_payment` and `removed_token_pending_payment_closes` (1.1).
- **`from_index` past the end, or `limit = 0`:** empty list, no panic. Tests `get_invoices_past_end_empty` (2.1) and `get_payments_limit_zero_empty` (1.2).

---

## 1. Contract: token allowlist and payment views

- [x] 1.1 Replace the gateway token with an operator allowlist and payment-owned token, and verify `cd contract && cargo test` passes `allowlisted_tokens_share_gateway`, `token_not_allowlisted_rejected`, `add_token_is_private`, `removed_token_rejects_new_payment`, `removed_token_pending_payment_closes`, plus every existing test
  1. In `contract/src/interface.rs`: drop `Gateway.token` and add `invoices: u32, payments: u32`. Add `Payment.token: AccountId` and `Payment.invoice: Option<InvoiceId>`. Add `PayMsg.invoice: Option<InvoiceId>`. Change the trait to `create_gateway(&mut self, payout_to: AccountId, policy: Policy) -> GatewayId` and add `add_token(&mut self, token: AccountId)`, `remove_token(&mut self, token: AccountId)`, `get_tokens(&self) -> Vec<AccountId>`.
  2. In `contract/src/lib.rs`: add `Key::Tokens` and `tokens: IterableSet<AccountId>`. Make `add_token`/`remove_token` `#[private]`. In `ft_on_transfer`, replace the gateway-token check with `require!(self.tokens.contains(&predecessor), "token not accepted")` and store `token` on the payment. In `close` and `retry`, transfer `payment.token`.
  3. Update the test `setup()`: call `add_token("usdc.near")` as `gateflow.near`, then `create_gateway(merchant, policy)`. Write the five tests above. Name the second token `nbtc.near`, and assert that `get_payment(..).token` matches the paying token.
  4. Commit `feat(contract)!: token allowlist, gateway without token`.
- [x] 1.2 Index payments per gateway and expose `get_payments`, and verify `cd contract && cargo test` passes `payments_paged_oldest_first`, `get_payments_unknown_gateway_empty`, `get_payments_limit_zero_empty`, `refunded_at_delivery_payment_listed`, `gateway_counts_payments`
  1. Add `Key::PaymentIndex` and `payment_index: LookupMap<(GatewayId, u32), PaymentId>`. In `open`, write slot `gateway.payments` and then increment it.
  2. Add `get_payments(&self, gateway: GatewayId, from_index: u32, limit: u32) -> Vec<(PaymentId, Payment)>` with page size `min(limit, 100)`. An unknown gateway returns an empty list.
  3. Tests: two payments come back as ids `[0, 1]` in order. A duplicate-`ref` payment (refunded at delivery) is listed. `get_gateway(0).unwrap().payments == 2`.
  4. Commit `feat(contract): get_payments view`.

## 2. Contract: invoices

- [x] 2.1 Add `create_invoice`, `get_invoice` and `get_invoices`, and verify `cd contract && cargo test` passes `create_invoice_open_with_expiry`, `create_invoice_non_owner_fails`, `create_invoice_rejects_bad_input`, `get_invoice_unknown_null`, `get_invoices_page`, `get_invoices_limit_capped`, `get_invoices_past_end_empty`, `gateway_counts_invoices`
  1. In `interface.rs`: add `InvoiceId`, `InvoiceStatus`, `Invoice` (Global Constraints), and the trait methods:
     - `create_invoice(&mut self, gateway: GatewayId, token: AccountId, amount: U128, expires_in_sec: u64, memo: Option<String>) -> InvoiceId`
     - `get_invoice(&self, invoice: InvoiceId) -> Option<Invoice>`
     - `get_invoices(&self, gateway: GatewayId, from_index: u32, limit: u32) -> Vec<(InvoiceId, Invoice)>`
  2. In `lib.rs`: add `Key::Invoices`, `Key::InvoiceIndex`, `next_invoice: InvoiceId`, `invoices: LookupMap<InvoiceId, Invoice>` and `invoice_index: LookupMap<(GatewayId, u32), InvoiceId>`. `create_invoice` checks the owner through `owned_gateway`, validates in the order token, amount, expiry, memo, logs `INVOICE`, and bumps `gateway.invoices`.
  3. `create_invoice_rejects_bad_input` asserts each panic message for these inputs: a non-allowlisted token, `amount 0`, `expires_in_sec` of 59 and of 2_592_001, and a memo of 141 bytes. Use `#[should_panic(expected = …)]` per case, or split into one test per message.
  4. `get_invoices_page`: create 5 invoices, then `get_invoices(0, 3, 10)` returns ids `[3, 4]`. `get_invoices_limit_capped`: 101 invoices with `limit 500` returns 100.
  5. Commit `feat(contract): create and list invoices`.
- [x] 2.2 Validate invoice payments and drive the invoice lifecycle from `close`, and verify `cd contract && cargo test` passes:
  - `exact_invoice_payment_marks_paying`
  - `invoice_wrong_amount_panics`
  - `invoice_wrong_token_panics`
  - `invoice_other_gateway_panics`
  - `unknown_invoice_panics`
  - `payment_at_expiry_rejected`
  - `paying_invoice_rejects_second_payment`
  - `ref_invoice_mismatch_refunds_invoice_unchanged`
  - `duplicate_ref_leaves_invoice_open`
  - `approved_marks_invoice_paid`
  - `rejected_marks_invoice_returned`
  - `reclaim_marks_invoice_returned`
  - `settle_failed_keeps_invoice_paid`

  Steps:
  1. Add a private `fn invoice_error(&self, pay: &PayMsg, token: &AccountId, amount: U128) -> Option<&'static str>`. It returns the first failing check, in the order unknown, other gateway, not open, expired, wrong token, amount.
  2. In `ft_on_transfer`:
     - Without `ref`, panic with the message returned by `invoice_error`.
     - With `ref`, set `rejected = duplicate_ref || invoice_error.is_some()`, open the payment with `invoice: None` when rejected, and close it as refunded.
     - An accepted invoice payment sets the invoice to `Paying` and its `payment = Some(id)`.
  3. In `close`: if `payment.invoice` is `Some(i)`, set invoice `i` to `Paid` when approved, otherwise `Returned`.
  4. Tests use a `pay_invoice(contract, msg, amount)` helper and the existing `closed` and `reclaim` patterns. `payment_at_expiry_rejected` sets `block_timestamp` to exactly `expires_at_sec * 1e9`.
  5. Commit `feat(contract): pay against invoices`.
- [x] 2.3 Build the release wasm and verify `cd contract && cargo build --target wasm32-unknown-unknown --release` succeeds with no warnings from `gateflow`.

## 3. Relay: quote by invoice

- [x] 3.1 Add an invoice payability check, and verify `cd relay && node --test src/*.test.ts` passes `open_invoice_payable`, `paying_invoice_not_payable`, `expired_invoice_not_payable`, `expiry_inside_quote_deadline_not_payable`
  1. In `relay/src/interfaces.ts`:
     - Add `Invoice { id: number; gateway: GatewayId; token: string; amount: bigint; expiresAtSec: number; status: "Open" | "Paying" | "Paid" | "Returned" }` and `Invoices { get(id: number): Promise<Invoice> }`.
     - Remove `Gateway.token` and the `Gateways` port if nothing else uses it.
     - Change `CheckoutRequest` to `{ invoice: number; originAsset; refundTo; refundOnNear }`.
  2. In `relay/src/checkout.ts`: add `export function payable(invoice: Invoice, nowMs: number, deadlineMs: number): string | undefined`. It returns the 409 reason, or `undefined` when the invoice is payable.
  3. Write the four tests in `relay/src/checkout.test.ts`.
  4. Commit `feat(relay): invoice payability check`.
- [x] 3.2 Quote by invoice in `/checkout/quote`, and verify `cd relay && node --test src/*.test.ts` passes. Also verify that `curl -s -XPOST localhost:8787/checkout/quote -d '{"invoice":999999,"originAsset":"x","refundTo":"x","refundOnNear":"bob.testnet"}'` against the testnet deploy from 4.1 returns 404 `{"error":"unknown invoice 999999"}`.
  1. In `relay/src/main.ts`, replace the `gateways` adapter with `invoices.get(id)`, which uses `viewGateflow("get_invoice", { invoice: id })` and throws `HttpError(404, \`unknown invoice ${id}\`)` when the result is null.
  2. Parse `body.invoice` as a non-negative integer, answering 400 "invoice must be a non-negative integer" otherwise.
  3. Answer `HttpError(409, reason)` when `payable` returns a reason.
  4. Build the quote with `amount = invoice.amount`, destination `invoice.token`, and `customRecipientMsg = { gateway: invoice.gateway, invoice: invoice.id, ref, refund_to: refundOnNear }`.
  5. Commit `feat(relay)!: quote by invoice`.

## 4. Deploy and docs

- [x] 4.1 Deploy fresh to testnet and run one invoice end to end. Verify that `near contract call-function as-read-only $D get_invoice json-args '{"invoice":0}'` shows `"status":"Returned"` after a direct payment from a named account (the expected fail-closed refund) and that `get_payments` lists it.
  1. Deploy to a new account `$D`, then call `add_token` for testnet USDC and `create_gateway` with `max_risk 80`. `fund` the gateway with 0.05 NEAR, then call `create_invoice` for 1 USDC with a 3600 s expiry.
  2. Pay with `ft_transfer_call` and `msg {"gateway":0,"invoice":0}`, then wait for `CLOSED`.
  3. Point the relay's `GATEFLOW_CONTRACT` and the OutLayer `GATEFLOW_CONTRACT` secret at `$D`.
- [x] 4.2 Update the GOAL.md testnet and mainnet runbooks and the README payment flow for the new `create_gateway(payout_to, policy)` signature, the `add_token` step, and `invoice` in `msg`/`customRecipientMsg`. Verify with `grep -n 'create_gateway' GOAL.md README.md`: no call passes a token argument.

## Workflow follow-up

- Point the OutLayer `GATEFLOW_CONTRACT` secret (profile `default`, owner `gateflow-f604a6.testnet`) at `gateflow-inv-6cf90f.testnet`. This needs the `gateflow-f604a6.testnet` key, and the old contract shares that profile. `screen_intents` needs the secret; direct-pay screening does not.
- Sync the `screen-cross-chain-payer` specs (`/opsx:sync`, without archiving) before archiving this change. This change's MODIFIED headers depend on that change's ADDED requirements.
- Archive after review.
