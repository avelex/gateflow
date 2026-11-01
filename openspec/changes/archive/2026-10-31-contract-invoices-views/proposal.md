# Proposal

## Why

The planned merchant console must list invoices, including unpaid ones, and a merchant's payments. The contract stores neither: a payment exists only once funds arrive, and no view lists anything. Each gateway also accepts one token, so invoicing in USDC and BTC would need several gateways with separate fuel and policy. This change adds on-chain invoices and paginated views, and lets one gateway per merchant accept every supported token.

## What Changes

- **New: invoices.** The gateway owner calls `create_invoice(gateway, token, amount, expires_in_sec, memo?)`. An invoice is Open, then Paying once a payment opens against it, then Paid on approval or Returned on refund. Returned is final, so the merchant issues a new invoice. An invoice past its expiry accepts no payment. No payer data is stored on-chain.
- **Paying an invoice.** `PayMsg` and the 1Click `customRecipientMsg` gain an optional `invoice`. The contract checks that the gateway matches, the token and amount are exact, the invoice is Open and it has not expired. A payment without a `ref` that fails these checks panics, so the funds return to the sender. A payment with a `ref` opens and is refunded in the same call, following the existing never-fail-at-delivery rule. Payments without an invoice are still accepted.
- **BREAKING: the gateway has no token.** `create_gateway(payout_to, policy)` loses its `token` argument, and `Gateway` loses its `token` field. An operator-owned token allowlist (`add_token`, `remove_token`, `get_tokens`) decides which NEP-141 tokens the contract accepts. `Payment` records its `token` and optional `invoice`. Settlement, refund and `retry` transfer `payment.token`.
- **New views:** `get_invoice`, `get_invoices(gateway, from_index, limit)` and `get_payments(gateway, from_index, limit)`.
- **Relay quote by invoice.** **BREAKING:** `POST /checkout/quote` takes `{invoice, originAsset, refundTo, refundOnNear}`. It reads the invoice for the gateway, token and amount, and puts `invoice` into `customRecipientMsg`.
- **Fresh testnet deploy.** There is no state migration.

## Capabilities

### New Capabilities
- `invoices`: invoice creation by the gateway owner, the invoice lifecycle, the rules for paying against an invoice, and the invoice views.

### Modified Capabilities
- `merchant-gateways`: a gateway no longer has a token. Payout is made in the payment's token. The gateway lookup drops the token.
- `payment-clearing`: payments come from allowlisted tokens and may name an invoice. A payment records its token and invoice. Close transfers the payment's token. A new view lists payments by gateway.
- `checkout-relay`: the quote is keyed by invoice instead of gateway plus amount.

## Impact

- **Contract** (`contract/src/`): new invoice storage, per-gateway indexes, a token allowlist, and new payment fields. The state layout changes, so a fresh deploy is needed.
- **Relay** (`relay/src/main.ts`, `interfaces.ts`): the quote reads `get_invoice`.
- **Enclave:** unchanged. The binding check ignores extra `customRecipientMsg` fields.
- **Spec ordering:** the deltas build on the unsynced `screen-cross-chain-payer` deltas, which must be synced first.
- **Assumption:** the last explore round (one gateway per merchant, operator allowlist, token-only invoices) was not explicitly answered, so its defaults are taken as accepted.
- **GOAL.md:** the deploy steps lose the `create_gateway` token argument.
