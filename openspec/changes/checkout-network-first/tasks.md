# Tasks

**Goal:** the checkout asks "Pay <symbol> from" first, with NEAR above the cross-chain networks, then offers only the payment method that network supports.

**Architecture:**
- `Checkout` owns the asset list and the picked network.
- A pure rule in `logic.ts` maps the network to its method and to the disabled tile's reason.
- `CrossChainPay` receives the picked asset and keeps only the form and the quote.

**Tech Stack:** React, Vite, vitest. Inline styles and design-system tokens, as the rest of `web/src/checkout/` uses.

**Spec:** `specs/payer-checkout/spec.md` and `design.md` in this change.

## Global Constraints

- Web tests: `cd web && npm test` (vitest). Web build: `cd web && npm run build`. Each task must leave both green.
- Commit after each task with a short conventional message, such as `feat(web): pick network before payment method`.
- Add no new npm dependency. No relay change.
- Exact copy:
  - list label `Pay <symbol> from`
  - tiles `Browser wallet` and `Address or QR`, under the heading `Pay by`
  - reasons `NEAR pays from a wallet` and `Wallet payment from <Chain> is coming`

## Review Focus

1. **Asset list request fails (relay down).** The list must still show NEAR alone, never an error-only column. Test `methods_near_only` in 1.1 covers the rule. The fetch's `.catch(() => [])` in 2.1 covers the request.
2. **Picking another network after filling the QR form.** The form must reset to the new chain's refund label. In 2.1, key `CrossChainPay` by `assetId` so its state resets.
3. **Resume with a saved quote.** The processing view still shows first, unchanged. Check in 2.1 that a stored quote skips the list.
4. **An invoice with a single cross-chain asset.** Nothing is auto-picked, because NEAR is always a second row. Check in 2.1.

## 1. Network-to-method rule

- [x] 1.1 In `web/src/checkout/logic.ts`, add `export type Method = "wallet" | "qr"`, `export function methodFor(chain: string): Method` and `export function blockedReason(chain: string, method: Method): string | undefined`.
  - `methodFor` returns `"wallet"` for `near`, else `"qr"`.
  - `blockedReason` returns undefined for the network's own method. For the other method it returns `"NEAR pays from a wallet"` from NEAR, or `` `Wallet payment from ${chainName(chain)} is coming` `` from any other chain.
  - Add these tests to `web/src/checkout/logic.test.ts`:
    - `methods_near`: `methodFor("near") === "wallet"`, `blockedReason("near", "qr") === "NEAR pays from a wallet"`, `blockedReason("near", "wallet") === undefined`.
    - `methods_evm`: `methodFor("arb") === "qr"`, `blockedReason("arb", "wallet") === "Wallet payment from Arbitrum is coming"`.
    - `methods_near_only`: `methodFor("btc") === "qr"`.
  - Verify: `cd web && npm test` fails before and passes after.

## 2. Network-first column

- [x] 2.1 Restructure the payment column.
  - **`CrossChainPay.tsx`:**
    - Export a `NetworkList({ symbol, assets, picked, onPick })`. It renders a `role="group"` labeled `Pay <symbol> from`, the label, a NEAR `ChainRow` (chain `near`, letter fallback), then `chainRows(assets)` rows.
    - Change `CrossChainPay` to `({ inv, asset, onQuote, children })`. Drop its fetch, list and auto-select.
  - **`Checkout.tsx`:**
    - Fetch `/checkout/assets?invoice=<id>` once per invoice, with `.catch(() => [])` so a failure leaves NEAR alone.
    - Replace `mode` with `network: string | undefined`.
    - Render `NetworkList`. Once a network is picked, render `PayWith`, now heading `Pay by` with `<button aria-pressed>` tiles; the blocked tile is `disabled` and shows `blockedReason` as its subtitle.
    - Then render either `NamedWarning` with `NearPayButton` (NEAR), or `<CrossChainPay key={asset.assetId} asset={asset} …>` (other networks).
  - Verify:
    - `cd web && npm run build` passes.
    - In the browser, with `/checkout/invoice` and `/checkout/assets` mocked as in the earlier list check:
      - The column first shows only the list, NEAR first, then Ethereum, Arbitrum and Base.
      - Picking NEAR shows the warning and "Connect wallet and pay", with Address or QR disabled.
      - Picking Arbitrum shows "Refund address on Arbitrum" and "Get deposit address", with Browser wallet disabled.
      - Switching back to NEAR hides the form.
      - With an assets request that returns 500, the list shows NEAR only.
      - A stored quote in `localStorage` shows the processing view.

## 3. Spec follow-through

- [ ] 3.1 Delete `PayWith`'s old "Pay with" usage and the `mode` state, and leave no unused export.
  - Verify: `cd web && npm run build` passes with `tsc --noEmit`, and `git grep -n '"Pay with"' web/src` finds nothing.

## Workflow follow-up

- Sync the `payer-checkout` delta and archive this change after review.
