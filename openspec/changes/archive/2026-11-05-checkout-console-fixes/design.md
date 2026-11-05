# Design

## Context

See proposal.md for the motivation. The current state that shapes the approach:

- **Payment JSON:** the contract serializes `Payment.reference` as `ref` (`contract/src/types.rs:73`). The web `Payment` type and `relay/src/chat.ts:80` read `reference`, and the test fixtures use `reference` too, so the tests pass.
- **Times on chain:** the contract stores `opened_at_sec`, but no screen or close time.
- **Screening tx:** the relay already fetches each payment's screening transaction once, with `EXPERIMENTAL_tx_status`, to parse evidence, and stores it once the payment is not Pending (`screening.ts` `evidenceFor`). For both flows, that transaction's receipt chain holds the OutLayer `execution_completed` receipt and the contract's `payment_closed` receipt. Each receipt outcome carries a `block_hash`.
- **Watcher:**
  - It polls `/v0/status` every 15 s for each open quote (`watcher.ts`).
  - A quote leaves the watcher once it is screened (`db.ts:117`).
  - 1Click's `updatedAt` is only the time of the last change, not a per-step time.
- **Origin senders:** only the enclave resolves them (`enclave/src/origin.rs`: publicnode EVM RPC, Esplora, Blockchair), and the verdict is all it reports.
- **Spike results:**
  - Dry quote, 1 USDC from Base: `amountIn` 1.010225, `minAmountIn` 1.000122. So `amountIn` includes the 1% slippage buffer.
  - Mainnet payment 3: deposited 10107, used 10005, `refundedAmount` 0, `refundFee` 5300. The excess was kept because a refund would have cost more than it.
- **Token data:**
  - `ft_metadata` of `nbtc.bridge.near` returns `NBTC`, while 1Click lists the same token as `BTC`.
  - Base lists `USDC` and `sUSDC`, both with `coingeckoId` `usd-coin`.
  - Bitcoin lists `BTC` and `BTC(OMNI)`, both with `bitcoin`.
- **Database:** SQLite tables are created with `CREATE TABLE IF NOT EXISTS`. There is no migration step.

## Goals / Non-Goals

**Goals:**
- One rule for naming the payer, used by the console, Search, Screening and the assistant.
- Times that come from the chain wherever the chain has them.

**Non-Goals:**
- Showing the actual 1Click cost after payment, which is `depositedAmount - amountOut` in the status response.
- Any swap from a different asset, or stablecoin classes (decision A of the exploration).
- Any contract or enclave change.
- A Markdown renderer.

## Decisions

1. **Rename the web and relay field to `ref`** to match the contract JSON, and fix the test fixtures. The alternative, mapping `ref` to `reference` in the relay, adds a second name for one field.

2. **The payer rule lives in the relay.**
   - The console payments endpoint adds `origin: {chain, senders} | null`, joined through `quoteByRef(payment.ref)`.
   - `payerLabel` in `web/src/console/logic.ts` uses `origin`, then `refund_to` when the payment has a `ref`, then `payer`.
   - `chat.ts` applies the same order, so the assistant names the payer the way the console does.
   - A chain id maps to a name through the existing `CHAIN_NAMES`, which moves to a shared module.

3. **Origin senders are resolved in the relay with a small port of the enclave resolvers.** It covers EVM `eth_getTransactionByHash` `from`, Esplora `vin[].prevout.scriptpubkey_address`, and Blockchair transparent inputs, against the same constant endpoints as `origin.rs`.
   - The quote insert stores `origin_chain`, taken from `originChain(tokens, originAsset)`.
   - On `SUCCESS`, the tick resolves the senders before `submitScreening` and stores `origin_senders` as JSON. A failed lookup never blocks screening.
   - The open-quote query also keeps screened quotes with `origin_senders IS NULL` inside the existing `deadline + 1h` window. The tick skips `submitScreening` for those.
   - Rejected alternative: having the enclave return the senders. That needs an enclave redeploy, and the verdict output feeds the contract.

4. **Step times:**
   - **Deposit seen:** `quotes.deposit_seen_ms`, set by `markQuote` the first time the status leaves `PENDING_DEPOSIT` or `UNKNOWN`. It is accurate to within the 15 s watch interval. That is acceptable for "Deposit detected", and it needs no origin-chain call.
   - **Opened:** `payment.opened_at_sec`.
   - **Screened and closed:** `parseEvidence` keeps the `block_hash` of the `outlayer.near` receipt that logged `execution_completed`, and of the Gateflow receipt that logged `payment_closed` for this payment. A new `near.block(hash)` reads `header.timestamp` (in ns) for each.
   - Block times are read only when the evidence is stored, that is when the payment is not Pending. Checkout polling therefore adds no RPC calls.
   - Evidence stored without a `closedAtSec` key is read again once. After that, the key is present: a number or null.

5. **Same-asset filter:**
   - The relay finds the 1Click asset of the invoice token with the existing `destinationAsset()`.
   - It keeps screenable-chain assets with the same `coingeckoId` **and** the same symbol, and takes the first match per chain in 1Click order.
   - Matching the symbol drops `sUSDC` and `BTC(OMNI)`.
   - `POST /checkout/quote` applies the same filter to `originAsset` and answers 422 otherwise.

6. **Fee line:** `amountIn - invoice.amount`, both converted to decimals with their own `decimals`, in the origin token. The text reads "0.010225 USDC of this covers the 1Click fee and slippage buffer". It does not say "refunded": the payment 3 evidence shows that a small excess is kept.

7. **Display symbol:** a constant map in the relay's `tokenMeta`, `{ "nbtc.bridge.near": "BTC" }`. Every console, checkout and assistant symbol passes through `tokenMeta`. Taking the 1Click symbol instead would make token metadata depend on 1Click being up. The system prompt drops `"BTC" means nBTC`, its example becomes `0.01 BTC`, and it gains a plain-text rule.

8. **Database migration:** on open, `db.ts` adds `deposit_seen_ms`, `origin_chain` and `origin_senders` to `quotes` with `ALTER TABLE … ADD COLUMN` for each column that `PRAGMA table_info(quotes)` lacks. All three are nullable, so old rows simply show no times and no origin.

9. **Web:**
   - **Chain cards:** buttons with `chainIcon`, the chain name, the symbol and `aria-pressed`, in place of the `Select`.
   - **Amount copy:** the existing `Hash` component, which already has a copy action, renders the amount.
   - **Timeline:** times go in the empty third grid column of `Timeline.tsx`, as `HH:MM:SS UTC`.
   - **Close time:** the console takes it from `payment.screening?.closedAtSec`.
   - **Modal:** the overlay gets `overflowY: auto`.
   - **Thinking indicator:** a CSS keyframe on three dots in `screens.css`, with a `prefers-reduced-motion` override.

## Risks / Trade-offs

- [Public RPC rate limits or outages leave the sender unresolved] → The payer falls back to the refund account. Retries are bounded by the quote window.
- [An origin address is personal data shown to the merchant] → It is already public on chain. The relay already stores deposit addresses, and only the gateway's merchant sees it.
- [The deposit-seen time can be up to 15 s late] → It is labeled as detection, not as the deposit block time.
- [One extra block RPC per closed payment, twice] → It runs once per payment, at store time.
- [A token outside the map with an odd `ft_metadata` symbol] → Out of scope. The map grows only when that happens.

## Migration Plan

Deploy the relay and web together, because the page now sends `?invoice=` to `/checkout/assets`. The column migration runs at startup. To roll back, redeploy the previous build: the extra columns are ignored.
