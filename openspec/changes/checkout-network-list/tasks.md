# Tasks

**Goal:** replace the checkout's chain card grid with an inline list of chains, with Ethereum L2s nested under Ethereum and a check on the selected row.

**Architecture:**
- A pure function in `web/src/checkout/logic.ts` orders and nests the relay's assets.
- `CrossChainPay.tsx` only renders the rows it returns.
- No relay, API or contract change.

**Tech Stack:** React, Vite, vitest. Inline styles and design-system tokens, as the rest of `CrossChainPay.tsx` uses.

**Spec:** `specs/payer-checkout/spec.md` and `design.md` in this change.

## Global Constraints

- Web tests: `cd web && npm test` (vitest). Web build: `cd web && npm run build`. Each task must leave both green.
- Commit after each task with a short conventional message, such as `feat(web): nest L2 chains in checkout list`.
- Add no new npm dependency.
- `PARENT_CHAIN` is exactly `{ base: "eth", arb: "eth" }`.
- Rows show the chain icon and chain name only, with no token symbol.

## Review Focus

1. **An L2 whose parent is absent** (Base without Ethereum) must become a top-level row, never a nested row under nothing. Test `chain_rows_orphan_l2` in 1.1.
2. **Ethereum after other chains in 1Click order** (Bitcoin listed before Ethereum) must still put Ethereum first. Test `chain_rows_eth_first` in 1.1.
3. **One asset only** must still be selected automatically and render as one top-level row. Test `chain_rows_single` in 1.1. The automatic selection itself is unchanged code in `CrossChainPay`.
4. **A chain id missing from `PARENT_CHAIN`** (for example `op`) must render top-level, with no crash. This is covered by `chain_rows_orphan_l2`, because both cases go through the same branch.
5. **An icon file that does not exist yet** must not break the build. Task 3 runs only once the user has supplied the PNGs.

## 1. Ordering and nesting rule

- [x] 1.1 In `web/src/checkout/logic.ts`, add `export const PARENT_CHAIN: Record<string, string> = { base: "eth", arb: "eth" }` and `export function chainRows<T extends { chain: string }>(assets: T[]): { asset: T; nested: boolean }[]`.
  - Rule (design decision 3):
    - A row is nested when `PARENT_CHAIN[chain]` is present among the input chains.
    - Top-level rows keep input order, except that `eth` moves first.
    - Each top-level row is followed by its nested rows, in input order.
  - Add these tests to `web/src/checkout/logic.test.ts`, with assets written as `{ chain }` objects:
    - `chain_rows_usdc`: `[base, arb, eth]` gives `eth:false, base:true, arb:true`.
    - `chain_rows_orphan_l2`: `[base, arb]` gives `base:false, arb:false`, and `[op, eth]` gives `eth:false, op:false`.
    - `chain_rows_eth_first`: `[btc, base, eth]` gives `eth:false, base:true, btc:false`.
    - `chain_rows_single`: `[btc]` gives `btc:false`.
    - `chain_rows_empty`: `[]` gives `[]`.
  - Verify: `cd web && npm test` fails before the function exists and passes after.

## 2. Chain list in the checkout

- [x] 2.1 In `web/src/checkout/CrossChainPay.tsx`, replace `ChainCard` with `ChainRow({ asset, nested, selected, onPick })`, rendered from `chainRows(assets)`. Apply design decision 4:
  - **Group:** the `role="group"` container becomes a flex column with no gap. It keeps its `aria-label` and the "Pay <symbol> from" label above it.
  - **Row base:** `<button aria-pressed className="hv">` with no border, `--radius-2` corners, and padding `10px 12px`.
  - **Row content:** a 28 px icon (or the existing letter circle), the chain name at 14 px / 600, and an `Icon name="check"` pushed to the right edge when the row is selected.
  - **Selected:** `--surface-selected` background. Unselected rows use `transparent`.
  - **Nested:** extra left padding (about 24 px) and a 6 px dot in `--ink-150` before the icon.
  - **Removed:** the symbol line.
  - Verify:
    - `cd web && npm run build` passes.
    - In `npm run dev`, a USDC invoice lists Ethereum, then Base and Arbitrum indented, each without "USDC".
    - Clicking Base moves the check to Base, and the refund label reads "Refund address on Base".
    - Tab reaches every row, and Enter selects it.

## 3. Base and Arbitrum icons (after the user supplies them)

- [x] 3.1 Copy the user's files to `web/src/assets/chain-base.png` and `web/src/assets/chain-arbitrum.png`. Import them in `web/src/assets.ts` and extend `CHAINS` to `{ eth: ethereum, base, arb: arbitrum, btc: bitcoin, zec: zcash }`.
  - Verify:
    - `cd web && npm run build` passes.
    - In `npm run dev`, the Base and Arbitrum rows show the logos instead of letter circles.

## Workflow follow-up

- Archive `checkout-console-fixes` before archiving this change. This delta's "Pay from another chain" text builds on that change's version of the requirement.
