# Proposal

## Why

The cross-chain picker shows one card per chain in a grid. That layout does not show that Base and Arbitrum are Ethereum L2s. It also grows into a wall of cards as `EVM_CHAINS` expands. Wallet network pickers use a single list instead: one row per chain, L2s nested under Ethereum, and a check on the selected row.

## What Changes

- The "Pay <symbol> from" chain cards become a vertical list. Each row has the chain icon and name. The selected row has a check mark.
- Ethereum L2s (Base, Arbitrum) are indented under Ethereum with a dot connector.
- When the invoice's asset has no Ethereum mainnet asset, the L2 rows appear at the top level. The list never shows a row that cannot be picked.
- Order: Ethereum, then its L2s in 1Click order, then the other chains in 1Click order.
- Rows no longer repeat the token symbol, because the group label already names it.
- New chain icons for Base and Arbitrum, supplied by the user as design exports.
- Not included: an "All networks" row, "New" badges, and a dropdown or popover. The list is inline and always open.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `payer-checkout`: "Pay from another chain" shows a list of chains with L2s nested under Ethereum, in place of one card per chain.

## Impact

- `web/src/assets.ts`: Base and Arbitrum icons.
- `web/src/checkout/logic.ts` and `logic.test.ts`: an L2 to parent chain map, and a pure function that orders and nests the chain rows.
- `web/src/checkout/CrossChainPay.tsx`: `ChainCard` becomes a list row, and the grid becomes a column.
- `web/src/assets/`: `chain-base.png` and `chain-arbitrum.png`.
- No relay, API or contract change. `GET /checkout/assets` is unchanged.
- Spec ordering: this delta builds on the `payer-checkout` delta of `checkout-console-fixes`. Archive that change first.
