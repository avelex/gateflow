# Proposal

## Why

The first mainnet payments exposed UI bugs and gaps:
- Every cross-chain payer shows as `intents.near`.
- The invoice modal does not scroll.
- The assistant replies with raw `**` markup.
- The cross-chain picker lists 57 unrelated tokens.
- Nobody sees when each step happened or what 1Click charges.

## What Changes

**Bugs**
- Read the payment's 1Click reference from the contract's JSON key `ref`. The web and relay read `reference`, which is always undefined. So the payer falls back to `intents.near`, and every payment shows flow "Cross-chain".
- The invoice modal overlay scrolls.
- The assistant's system prompt requires plain text without Markdown.
- The chat's "Thinking…" row is animated.

**Times**
- The relay stores the block times of the screening and close receipts with the screening evidence.
- The relay records when its watcher first sees a cross-chain deposit.
- The checkout timeline shows a UTC time on each completed step.
- The console shows the close time of a Paid or Returned invoice in place of its expiry.

**Paying from another chain**
- `GET /checkout/assets?invoice=<id>` returns only origin assets with the same 1Click `coingeckoId` as the invoice token, one per chain. A BTC invoice offers only native Bitcoin.
- The checkout shows one card per chain, with its icon, in place of the token select.
- "Send exactly" gets a copy action and a line giving the 1Click fee and slippage buffer: the quote's `amountIn` minus the invoice amount.
- `nbtc.bridge.near` shows as `BTC` everywhere.

**Real payer**
- For a cross-chain payment, the relay resolves the origin-chain sender from 1Click's `originChainTxHashes` and stores it with the quote.
- The console shows that sender, for example `0x12ab…cd on Base`. It falls back to the NEAR refund account when the sender is unknown.
- A direct payment keeps `payer`.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `payer-checkout`: chain picker, copy and fee line, step times.
- `checkout-relay`: same-asset assets, step times, origin sender.
- `screening-evidence`: screening and close block times.
- `merchant-console`: payer, close time, BTC symbol, scrollable modal.
- `console-assistant`: plain text, BTC symbol, thinking animation.

## Impact

- **relay:**
  - `checkout.ts`, `watcher.ts`, `screening.ts`, `console.ts`, `chat.ts`, `near.ts` (a `block` read), `db.ts` (nullable `quotes` columns).
  - New outbound calls to the public EVM, Esplora and Blockchair endpoints the enclave already uses.
- **web:** checkout `CrossChainPay`, `Timeline` and `logic`; console `logic`, `cards`, `Invoices` and `Chat`.
- **No change** to the contract or the enclave.
- **Old rows:** no times, and the payer falls back to the refund account.
