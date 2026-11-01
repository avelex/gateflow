# Proposal

## Why

The Gateflow NEAR contract has to be written from scratch: this repository has the specs but no `contract/` code. The rewrite is also the moment to close two gaps that block an honest mainnet launch. First, the operator acts through the contract account's own key, and that key can deploy new code and drain the escrow, so "non-custodial" is not true. Second, payments that need no invoice can be spammed: dust `ref` payments grow storage that the contract pays for, and dust direct payments burn screening fuel that the operator tops up.

## What Changes

- **One NEAR contract, `gateflow`.** Multi-chain payments still arrive through NEAR Intents 1Click. The contract knows only NEP-141 tokens and the `ref`; origin chains stay the enclave's concern, so a new origin chain needs no contract change.
- **Operator is a role in state.** `operator: AccountId` is set at `new()` and can be rotated with `set_operator`. Only the operator can call `add_token`, `remove_token` and `set_enclave`. The contract account keeps no full-access key, and the contract has no upgrade path. A bug fix means deploying a new contract.
- **Funds have exactly two exits.** Tokens leave the contract only to the gateway's `payout_to` (set by the owner) or to the payment's `refund_to` (set by the payer). No operator method moves funds.
- **BREAKING: every payment names an invoice.** `msg` becomes `{"invoice": <id>, "ref"?: <string>, "refund_to"?: <account>}`. `gateway` is dropped from `msg`, because the invoice determines the gateway. A payment without an invoice is rejected.
- **BREAKING: `ref` payments only from `intents.near`.** A `ref` payment with any other `sender_id` is rejected at delivery. 1Click deliveries keep the never-panic rule.
- **BREAKING: the 1Click binding checks the invoice.** The enclave matches `invoice` and `ref` in `customRecipientMsg` instead of `gateway` and `ref`.
- **Structured events.** The plain `OPENED`, `CLOSED`, `INVOICE` and `TRANSFER_FAILED` logs become NEP-297 events.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `payment-clearing`: the `msg` must name an invoice; a `ref` must come from `intents.near`; the operator role replaces the contract account; funds leave only to the payout or refund account; the enclave binding uses the invoice; events follow NEP-297.
- `invoices`: a payment matches its invoice without a separate gateway check, and invoice creation emits a NEP-297 event.

## Impact

- **`contract/`:** new code, Rust near-sdk 5. Fresh deployment with no state migration.
- **Enclave:** the binding compares `invoice` instead of `gateway`. The `screen_intents` execution request carries `invoice`.
- **Relay:** must remove the contract account's full-access key after deployment. The relay's quote may keep sending `gateway` in `customRecipientMsg`, because the contract ignores unknown fields. The screening watcher must parse NEP-297 events.
- **Out of scope:** payouts or refunds on origin chains, payments without invoices (donations, POS), BYOK screening keys, and the console assistant.
