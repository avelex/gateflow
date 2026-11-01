# Design

## Context

Motivation: see proposal.md (Why). The contract (`contract/src/lib.rs`) keeps `gateways`, `payments` and `refs` in `near_sdk::store::LookupMap` and has no iterable collection. `ft_on_transfer` checks `predecessor == gateway.token`. `close` and `retry` transfer `gateway.token`. The `ref` branch already turns deposit-time rejections (duplicate `ref`) into open-and-refund within the same call. The relay's `/checkout/quote` reads `get_gateway` to find the destination token. The enclave's 1Click binding (`enclave/src/oneclick.rs`) compares only `gateway` and `ref` in `customRecipientMsg`, so it accepts extra fields.

The parked `screen-cross-chain-payer` change has implemented the `ref` flow in code, but its spec deltas are not yet synced. This change's deltas are written against that post-sync text.

## Goals / Non-Goals

**Goals:**
- Have one gateway per merchant, accepting every allowlisted token.
- Make invoices a contract-enforced price tag that the console can page through.
- Leave the enclave and the screening flow unchanged.

**Non-Goals:**
- Cancelling or editing an invoice, fiat-denominated invoices, payer data, partial payments.
- `get_gateways(owner)`. The console backend maps each merchant to a gateway id.
- Charging invoice storage to the merchant.
- Migrating existing testnet state.

## Decisions

**1. Per-gateway indexes as composite-key maps plus counters on `Gateway`.**
- Storage: `invoice_index: LookupMap<(GatewayId, u32), InvoiceId>` and `payment_index: LookupMap<(GatewayId, u32), PaymentId>`.
- `Gateway` gains `invoices: u32` and `payments: u32`. Each counter is both the next slot and the count that `get_gateway` returns.
- Page reads walk slots `from_index..min(from_index + limit, count)`.
- *Alternative:* a nested `Vector` per gateway inside a `LookupMap`. It needs a storage prefix per gateway and depends on near-sdk's flush-on-drop behaviour. The flat map has no such pitfalls and costs the same storage.
- Paging is oldest-first. The console gets newest-first by reading the count and paging from the end.

**2. Token allowlist is an `IterableSet<AccountId>` with `#[private]` add and remove.**
- `#[private]` means only the contract account can call these methods, matching `set_enclave_project`. This is the "operator" in the specs.
- `get_tokens` returns the set. It stays small (USDC, nBTC, ZEC).
- `Gateway.token` is removed. `Payment.token` is set from `predecessor_account_id()` at delivery.
- `close` and `retry` transfer `payment.token`, so removing a token never strands an open payment.

**3. A payment links to an invoice only when it is accepted.**
- `ft_on_transfer` validates the invoice before opening the payment: it exists, belongs to the `msg` gateway, is Open, is unexpired, and the token and amount match.
- For the `ref` branch, `rejected = duplicate_ref || invoice_failed`.
- A rejected payment opens with `invoice: None` and closes as refunded. Then `close` never touches an invoice that the payment did not win.
- An accepted payment sets the invoice to Paying with `payment = id`.
- In `close`, if `payment.invoice` is set, the invoice becomes Paid when the payment is approved and Returned otherwise. `reclaim` and `on_screened` both go through `close`, so they need no extra branches.
- A failed transfer (`SettleFailed`/`RefundFailed`) does not move the invoice back. The screening decision has already been made.
- Error strings: "unknown invoice", "invoice is for another gateway", "invoice is not open", "invoice expired", "wrong token for this invoice", "amount does not match the invoice", "token not accepted", "invalid expiry", "memo too long".

**4. Expiry is derived, not stored as a status.**
- The status enum is `Open | Paying | Paid | Returned`.
- "Expired" means Open with `expires_at_sec <= now`. It is checked at payment time and computed by clients.
- *Alternative:* a stored Expired state needs a keeper or a lazy write on read. Views cannot write, so a stored state would be stale.

**5. `create_invoice` charges no storage deposit.**
- Merchants will sign through relayed meta-transactions and hold no NEAR, so the contract's own balance pays for storage. Each invoice is about 200 bytes.
- Only the gateway owner can create invoices, which bounds spam to the merchants the operator onboards.

**6. The relay quotes by invoice.**
- `CheckoutRequest` becomes `{invoice, originAsset, refundTo, refundOnNear}`.
- The `Gateways` port is replaced by an `Invoices.get(id)` port backed by `viewGateflow("get_invoice")`.
- It answers 404 for an unknown invoice, and 409 when the invoice is not Open or `expires_at_sec * 1000 <= Date.now()`.
- The quote uses `amount = invoice.amount`, the destination is `invoice.token`, and `customRecipientMsg` gains `invoice`.

## Risks / Trade-offs

- **The quote outlives the invoice.** A 1Click quote is valid for 30 minutes, and the invoice can expire before delivery. The contract then refunds through the `ref` rule. The payer loses only the bridge fees, and the console shows the invoice as expired. *Mitigation:* the relay refuses to quote when the invoice expires within the quote deadline.
- **Invoice spam drains the contract's balance.** *Mitigation:* invoice creation is owner-only. Charging gateway fuel per invoice can come later if needed.
- **Archive ordering with the parked change.** Its deltas modify the same `payment-clearing` and `checkout-relay` requirements, and this change's MODIFIED headers include requirements that only exist after that sync. *Mitigation:* sync `screen-cross-chain-payer` specs (sync only, not archive) before archiving this change.
- **Named NEAR payers always fail screening.** This is existing behaviour, unchanged here: a direct payment from `alice.testnet` is refunded. The direct-pay path for invoices therefore only settles for EVM-implicit payers. This matters for the console and checkout change, not this one.

## Migration Plan

1. Deploy to a new testnet account with `new(...)`, call `add_token` for each test token, create a gateway with `create_gateway(payout_to, policy)`, and `fund` it.
2. Point the relay's `GATEFLOW_CONTRACT`, the enclave's `GATEFLOW_CONTRACT` secret, and the OutLayer secrets at the new account.
3. Update the GOAL.md runbooks for the new `create_gateway` signature and the `add_token` step.
4. Rollback: point the relay back at the old contract account, which is left untouched.
