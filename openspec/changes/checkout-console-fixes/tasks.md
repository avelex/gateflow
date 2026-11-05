# Tasks

**Goal:** fix the checkout and console bugs, add step times, offer only the invoice's asset when paying from another chain, and show the real origin payer.

**Architecture:**
- The relay computes every new fact and the web only displays it: display symbols, step times, origin senders and same-asset assets.
- New outside calls go through ports in `Deps`, like `oneclick` and `outlayer`, so tests use fakes.
- No contract or enclave change.

**Spec:** `specs/*/spec.md` and `design.md` in this change.

## Global Constraints

- Relay tests: `cd relay && npm test` (node:test). Web tests: `cd web && npm test` (vitest). Web build: `cd web && npm run build`. Each task must leave all three green.
- Commit after each task with a short conventional message, such as `fix(web): read payment ref`.
- Add no new npm dependency.
- Times show as UTC, ending in `UTC`. Console dates use the existing `utc()` in `web/src/console/cards.tsx`: `YYYY-MM-DD HH:MM`. Checkout step times use `HH:MM:SS UTC`.
- The display symbol map is exactly `{ "nbtc.bridge.near": "BTC" }`.
- Origin endpoints are the constants from `enclave/src/origin.rs`:
  - `https://base-rpc.publicnode.com`
  - `https://ethereum-rpc.publicnode.com`
  - `https://arbitrum-one-rpc.publicnode.com`
  - `https://blockstream.info/api/tx/{hash}`
  - `https://api.blockchair.com/zcash/dashboards/transaction/{hash}`

## Review Focus

1. **Evidence stored before this change has no `closedAtSec` key.** It must be re-read exactly once, never on every poll. Test `legacy_evidence_gets_times` in 4.3.
2. **The watcher drops a quote once it is screened.** The sender must still resolve on a later tick if the first lookup failed. Test `watcher_retries_sender_after_screened` in 6.3.
3. **An EVM `from` arrives in mixed case.** Stored senders are lowercase. Test `evm_sender_lowercase` in 6.1.
4. **A payment with a `ref` but no quote row in this relay's DB**, for example one paid through another relay instance. The payer must fall back to `refund_to`, never `intents.near`. Test `payer_ref_without_origin` in 1.1.
5. **The origin and NEAR tokens may use different decimals.** The fee line must use each token's own decimals. Test `fee_line_mixed_decimals` in 9.2.

## 1. Payment `ref` field

- [x] 1.1 In `web/src/console/logic.ts`, rename `Payment.reference` to `ref: string | null`. Update `payerLabel` and the `Flow` field in `screeningFields` to use it, and change every fixture in `web/src/console/logic.test.ts` from `reference` to `ref`.
  - Add `payer_ref_without_origin`: `payerLabel({..., ref: "ab…", payer: "intents.near", refund_to: "bob.near"}) === "bob.near"`.
  - Add `flow_direct_without_ref`: `ref: null` gives Flow "Direct".
  - Verify: `cd web && npm test` passes both tests.
- [x] 1.2 In `relay/src/chat.ts:80`, read `p.ref` instead of `p.reference`.
  - Add `chat_payer_uses_ref` to `relay/src/chat.test.ts`: a payment `{ref: "r1", payer: "intents.near", refund_to: "bob.near"}` yields payer `bob.near`.
  - Verify: `cd relay && npm test`.

## 2. Small console fixes

- [ ] 2.1 Make the `InvoiceModal` overlay in `web/src/console/Invoices.tsx` scroll: `overflowY: "auto"` on the `position:absolute; inset:0` div.
  - Verify: run `npm run dev`, open an invoice in a 700 px tall window, expand Details, and scroll the modal to "Copy payment link".
- [x] 2.2 In `systemPrompt` in `relay/src/chat.ts`:
  - Add the rule `- Write plain text only, without Markdown: no **, #, backticks or bullet markup.`
  - Change the amount example to `0.01 BTC`.
  - Remove `"BTC" means nBTC`, keeping the NEAR and dollars aliases.
  - Add `prompt_plain_text` to `chat.test.ts`: the prompt contains `plain text` and does not contain `nBTC`.
  - Verify: `cd relay && npm test`.
- [ ] 2.3 Replace the static "Thinking…" in `web/src/console/Chat.tsx` with "Thinking" plus three dots. A `gf-think` keyframe in `web/src/screens.css` (opacity 0.2 to 1, staggered 0.2 s) animates the dots. Under `@media (prefers-reduced-motion: reduce)`, no animation runs and the dots stay visible.
  - Verify: send a chat message in `npm run dev` and see the dots animate. With reduced motion emulated in devtools, they stay still.

## 3. Display symbol

- [x] 3.1 In `relay/src/console.ts`, add `export const DISPLAY_SYMBOL: Record<string, string> = { "nbtc.bridge.near": "BTC" }`. In `tokenMeta`, return `DISPLAY_SYMBOL[token] ?? m.symbol`.
  - Add `nbtc_shows_btc` to `console.test.ts`: the fake `ft_metadata` of `nbtc.bridge.near` returns `NBTC`, and `tokenMeta` gives symbol `BTC`.
  - Add `checkout_nbtc_symbol` to `checkout.test.ts`: `GET /checkout/invoice` for an nBTC invoice has `symbol: "BTC"`.
  - Verify: `cd relay && npm test`.

## 4. Step times in the relay

- [x] 4.1 Migrate the DB in `relay/src/db.ts`. After the `CREATE TABLE` statements, add each missing `quotes` column, as found by `PRAGMA table_info(quotes)`, with `ALTER TABLE quotes ADD COLUMN`:
  - `deposit_seen_ms INTEGER`
  - `origin_chain TEXT`
  - `origin_senders TEXT`

  Then extend `Quote` with `deposit_seen_ms: number | null; origin_chain: string | null; origin_senders: string | null`, and make `insertQuote` take an optional `origin_chain`.
  - Add `quotes_columns_added` to `relay/src/console.test.ts` (or a new `db.test.ts`): open a DB file that has the old `quotes` schema and one row, and check that all three columns exist and the row's new columns are null.
  - Verify: `cd relay && npm test`.
- [x] 4.2 Record the deposit time and the origin chain.
  - `markQuote(ref, {status, nowMs})` sets `deposit_seen_ms = nowMs` only while the column is null and `status` is not `PENDING_DEPOSIT` or `UNKNOWN`.
  - `watcher.ts` passes `deps.now()`.
  - The `quote` handler in `checkout.ts` stores `origin_chain: originChain(tokens, b.originAsset)`.
  - Add `watcher_records_deposit_seen` to `watcher.test.ts`: statuses `PENDING_DEPOSIT` at t=1000, then `PROCESSING` at t=16000, then `SUCCESS` at t=31000, leave `deposit_seen_ms` at 16000.
  - Verify: `cd relay && npm test`.
- [ ] 4.3 Read the block times into the evidence.
  - Add `block(hash: string): Promise<{ timestampSec: number }>` to the `Near` port in `relay/src/near.ts`. It wraps RPC `block` with `block_id`, using `Math.floor(header.timestamp / 1e9)`. Add it to the fake in `testing.ts` too.
  - `parseEvidence` also returns `completedBlock: string | null`, the `block_hash` of the `outlayer.near` receipt holding `execution_completed`.
  - Add `closedBlock(tx, gateflow, payment): string | null` in `screening.ts`: the `block_hash` of the receipt whose `executor_id` is the Gateflow contract and that logs a `gateflow` `payment_closed` event with `data[0].payment === payment`.
  - When `evidenceFor` stores evidence, it adds `screenedAtSec` and `closedAtSec` (number or null) from `near.block`.
  - Stored evidence without a `closedAtSec` key is re-read from the chain and stored once.
  - Extend `Screening` in `relay/src/screening.ts` and `web/src/checkout/logic.ts` with both fields.
  - Add to `screening.test.ts`, using `fixtures/tx-success.json` with block hashes set:
    - `evidence_has_times`
    - `spoofed_close_ignored`: a `payment_closed` from another executor
    - `pending_has_no_times`
    - `legacy_evidence_gets_times`: stored evidence without the key causes one `tx` call, and a second request makes no RPC call
  - Verify: `cd relay && npm test`.
- [ ] 4.4 `GET /checkout/invoice` returns `times: {depositSeenAtSec, openedAtSec, screenedAtSec, closedAtSec}`, each `number | null`:
  - `depositSeenAtSec` comes from the quote matching `payment.ref`.
  - `openedAtSec` comes from `payment.opened_at_sec`.
  - The other two come from the evidence.
  - Add `CheckoutInvoice.times` to `web/src/checkout/logic.ts`.
  - Add `checkout_times_paid` (spec values 1793857780, 1793857812, 1793857840, 1793857841) and `checkout_times_open_null` to `checkout.test.ts`.
  - Verify: `cd relay && npm test`.

## 5. Step times in the web

- [ ] 5.1 `timeline()` in `web/src/checkout/logic.ts` attaches `atSec?: number` to each done step:
  - Deposit detected: `depositSeenAtSec`.
  - Delivered: `openedAtSec`.
  - Screening: `screenedAtSec`.
  - Released or Returned: `closedAtSec`.

  `Timeline.tsx` renders `atSec` in its empty third column as `HH:MM:SS UTC`, through a new `utcTime(sec)` in `web/src/format.ts`.
  - Add to `logic.test.ts`: `timeline_times_paid`, which checks the four steps' `atSec` against the spec scenario, and `timeline_time_missing`, where a null time gives no `atSec`.
  - Add to `format.test.ts`: `utcTime(1793857841) === "05:50:41 UTC"`.
  - Verify: `cd web && npm test`.
- [ ] 5.2 Show the close time in the console.
  - Add `closedAt(inv, payments): number | undefined` in `web/src/console/logic.ts`. It returns `screening.closedAtSec` for a Paid or Returned invoice.
  - `InvoiceCard` shows `paid {utc} UTC` or `returned {utc} UTC` in place of `expires …` when the value is set.
  - The Invoices list column becomes "Time, UTC", with cells `Paid 2026-11-05 05:50`, `Returned …` or `Expires …`.
  - Add `closed_at_paid` and `closed_at_unknown_falls_back` to `logic.test.ts`.
  - Verify: `cd web && npm test && npm run build`.

## 6. Origin sender in the relay

- [ ] 6.1 Create `relay/src/origin.ts` with pure helpers ported from `enclave/src/origin.rs`:
  - `originRequest(chain, hash): { url: string; init?: RequestInit } | undefined`: an EVM `eth_getTransactionByHash` POST for base, eth and arb, an Esplora GET for btc, a Blockchair GET for zec, and undefined otherwise.
  - `parseSenders(chain, hash, body: any): string[] | undefined`:
    - EVM: `result.from`, lowercased.
    - BTC: every `vin[].prevout.scriptpubkey_address`.
    - ZEC: every non-empty `data[hash].inputs[].recipient`.
    - Undefined when nothing parses.
  - Add `origin.test.ts`, using the enclave fixtures copied to `relay/src/fixtures/` (`evm-tx.json`, `btc-tx.json`, `zec-transparent.json`, `zec-shielded.json`):
    - `evm_sender_lowercase`
    - `btc_all_inputs`
    - `zec_transparent_inputs`
    - `zec_shielded_none`
    - `unknown_chain_none`
  - Verify: `cd relay && npm test`.
- [ ] 6.2 Add an `origin` port to `Deps` in `types.ts`: `{ senders(chain: string, hash: string): Promise<string[] | undefined> }`.
  - In `main.ts`, implement it with `fetch` and a 5 s timeout, using the helpers from 6.1.
  - In `testing.ts`, add a fake with a settable map and a failure switch.
  - Verify: `cd relay && npm test` and `cd relay && node --check src/main.ts`.
- [ ] 6.3 Make the watcher resolve senders.
  - On `SUCCESS`, `tick` first tries `deps.origin.senders(q.origin_chain, status.swapDetails.originChainTxHashes[0].hash)` and stores the JSON array through a new `db.setOriginSenders(ref, senders)`. It then runs the existing screening path. A throw is logged and does not block screening.
  - `openQuotes` also returns quotes with `screened = 1 AND origin_senders IS NULL AND origin_chain IS NOT NULL`, inside the same window.
  - `tick` calls `submitScreening` only when `screened = 0`.
  - Add to `watcher.test.ts`:
    - `watcher_stores_sender`
    - `watcher_sender_failure_still_screens`
    - `watcher_retries_sender_after_screened`
    - `watcher_drops_resolved_screened_quote`
  - Verify: `cd relay && npm test`.
- [ ] 6.4 Each `GET /console/payments` row gains `origin: {chain, senders} | null`, from `quoteByRef(p.ref)` when both columns are set. `chat.ts` computes the payer by the console rule: `senders[0]` with `" on " + chainName`, then `refund_to` when the payment has a `ref`, then `payer`.
  - Add `payments_carry_origin` to `console.test.ts`.
  - Add `chat_payer_origin` to `chat.test.ts`.
  - Verify: `cd relay && npm test`.

## 7. Origin payer in the web

- [ ] 7.1 Move `CHAIN_NAMES` and `chainName()` into `web/src/assets.ts`, next to `chainIcon`. Import them in `CrossChainPay.tsx` and `Settings.tsx`.
  - Add `Payment.origin` to `web/src/console/logic.ts`.
  - `payerLabel` returns `${short(senders[0])} on ${chainName(chain)}`, plus ` +N` when there is more than one sender. `short` keeps 6 head and 4 tail characters with `…`. Without an origin it falls back as in 1.1.
  - Add to `logic.test.ts`:
    - `payer_origin_base`: `0x12ab34…56cd` on base gives `0x12ab…56cd on Base`
    - `payer_origin_btc_plus`: three senders give a label ending `on Bitcoin +2`
    - `payer_direct`
  - Verify: `cd web && npm test && npm run build`.

## 8. Same-asset quotable assets

- [ ] 8.1 Add `sameAssets(tokens, token, evmChains): Asset[]` in `relay/src/checkout.ts`.
  - It finds the 1Click asset of `token` through `destinationAsset`, then keeps the screenable assets with an equal `coingeckoId` and `symbol`, taking the first match per chain.
  - `GET /checkout/assets` requires `?invoice=<id>`: 400 when the id is invalid, 404 when the invoice is unknown. It returns `sameAssets` for the invoice token.
  - Update `assets_screenable_only` for the new parameter.
  - Add, using a fixture extended with sUSDC on base, `BTC(OMNI)`, cbBTC and USDT on eth:
    - `assets_usdc_same_asset`: exactly base, arb and eth USDC
    - `assets_btc_native_only`
    - `assets_unknown_token_empty`
    - `assets_requires_invoice`
  - Verify: `cd relay && npm test`.
- [ ] 8.2 `POST /checkout/quote` answers 422 "originAsset is not this invoice's asset" when `originAsset` is not in `sameAssets`, and makes no 1Click call.
  - Add `quote_other_asset_422`.
  - Verify: `cd relay && npm test`.

## 9. Pay from another chain, on the web

- [ ] 9.1 In `web/src/checkout/CrossChainPay.tsx`:
  - Fetch `/checkout/assets?invoice=${inv.id}`.
  - Replace the `Select` with one button card per asset, with `chainIcon`, the chain name, the symbol and `aria-pressed`.
  - With no assets, say "This invoice can only be paid with a NEAR wallet." and hide the form and the quote button.
  - Verify: `npm run build`, then in `npm run dev` with the fake relay, a USDC invoice shows Base, Arbitrum and Ethereum cards.
- [ ] 9.2 Make `DepositPanel` render the amount with `<Hash value={amountInFormatted} head={64} tail={0} />` so it gets the copy action.
  - Add `feeLine(q: SavedQuote, inv: CheckoutInvoice, originDecimals: number): string | undefined` in `web/src/checkout/logic.ts`. It returns `"<x> <symbol> of this covers the 1Click fee and slippage buffer."`, where x is `amountIn` (at `originDecimals`) minus `inv.amount` (at `inv.decimals`), computed by string math through `formatAmount`/`parseAmount`. It returns undefined when x ≤ 0.
  - `SavedQuote` stores `decimals`.
  - Add to `logic.test.ts`:
    - `fee_line_usdc`: `amountIn` 1010225 at 6 decimals, invoice 1000000 at 6 decimals, gives `0.010225 USDC …`
    - `fee_line_mixed_decimals`: origin at 18 decimals, invoice at 6
    - `fee_line_none_when_exact`
  - Verify: `cd web && npm test && npm run build`.

## 10. Integration check

- [ ] 10.1 Run the relay and web locally against mainnet (read-only) with the merchant session from `mainnet-launch`. Check that:
  - Invoices #0–#4 show payer `<0x…> on Base`, after the watcher's sender backfill for payments whose quotes are still in its window, or else the refund account. None shows `intents.near`.
  - Paid rows show `Paid …` times.
  - The checkout page of invoice 4 shows four step times.
  - The cross-chain picker of a new USDC invoice shows exactly three chain cards and the fee line after a quote.

  Record the observations in this task.

## Workflow follow-up

- Run `/opsx:archive` after review.
