# Design

## Context

See proposal.md for the motivation. The current state that shapes the approach:

- **Picker:** `CrossChainPay.tsx` renders `GET /checkout/assets?invoice=<id>` as a `ChainCard` grid. Each card is a `<button aria-pressed>` showing the chain icon (or a letter circle), the chain name and the symbol. A single asset is selected automatically.
- **Relay output:** at most one asset per chain, in 1Click token order, limited to `EVM_CHAINS` (default `base,eth,arb`) plus `btc` and `zec`. A USDC invoice gets 3 rows today, and a BTC invoice gets 1.
- **Icons:** `assets.ts` maps only `eth`, `btc` and `zec`. It draws no icon that the design exports do not have.
- **Design system:** `Icon` has `check`. There is no popover or listbox component.

## Goals / Non-Goals

**Goals:**
- The ordering and nesting rule is a pure function with unit tests. The component only renders rows.

**Non-Goals:**
- A dropdown or popover, search, "All networks", or "New" badges.
- Arrow-key roving focus. Rows stay ordinary buttons in tab order, as the cards are today.
- Any relay change. The web derives the grouping from the chain ids the relay already returns.

## Decisions

1. **Inline list over dropdown.** With 1 to 5 rows, an always-open list costs about the same code as the card grid. A dropdown needs open and close state, Esc and outside-click handling, positioning, and `aria-expanded`/listbox wiring. Revisit when the list grows past about 6 chains.

2. **The L2 to parent map lives in the web**, as a static `PARENT_CHAIN: Record<string, string> = { base: "eth", arb: "eth" }` in `checkout/logic.ts`, next to the function that uses it. It stays out of `assets.ts`, so the logic tests import no PNG files.
   - Rejected alternative: a `parent` field from the relay. That would be an API change for display-only data.
   - Adding an EVM chain to `EVM_CHAINS` requires one entry here if the chain is an L2.

3. **Ordering and nesting function** in `checkout/logic.ts`: `chainRows(assets) -> { asset, nested }[]`.
   - A row is nested when its chain has a parent in `PARENT_CHAIN` and the input contains that parent's chain.
   - Top-level rows keep 1Click order, except that `eth` moves first. Each parent row is followed by its nested rows in 1Click order.
   - An orphan L2, whose parent is missing, becomes a top-level row. No row is ever shown that cannot be picked.

4. **Row rendering:**
   - `ChainCard` becomes `ChainRow`: icon, name, and a trailing `check` icon when the row is selected.
   - The selected row gets a `--surface-selected` background, and hover uses the existing `hv` class. Rows have no borders between them.
   - A nested row is indented with a small dot connector in front of its icon.
   - The row keeps `aria-pressed`, and the group keeps `role="group"` with its "Pay <symbol> from" label.
   - The symbol line is removed.

5. **Icons:** the user supplies `chain-base.png` and `chain-arbitrum.png` in `web/src/assets/`. Each is imported and added to `CHAINS` in `assets.ts`. The letter-circle fallback stays for any chain without an icon.

## Risks / Trade-offs

- [The icon exports arrive late] → The letter circle covers rows without an icon. Do not commit imports of files that do not exist yet.
- [1Click adds an L2 chain id that is missing from `PARENT_CHAIN`] → The chain shows as a top-level row. The list stays correct, only the nesting is missing.
- [Spec ordering: this delta's base text comes from the unarchived `checkout-console-fixes`] → Archive `checkout-console-fixes` before this change.
