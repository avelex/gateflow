# Proposal

## Why

The checkout's right column first asks "Pay with": Browser wallet (NEAR) or Address or QR. The chain list sits inside the second option. Payers think in terms of where their money is, not which method to use. The page should ask that first, then offer only the methods that work from that network.

## What Changes

- An Open invoice's payment column starts with one question: "Pay <symbol> from", followed by a network list.
- The list shows NEAR at the top, then the relay's same-asset origin chains, laid out as today (Ethereum L2s nested under Ethereum, a check on the selected row).
- Nothing else shows until a network is picked: no method tiles, form or pay button.
- After the pick, two method tiles appear: **Browser wallet** and **Address or QR**. Only the method the network supports is enabled, and it is selected automatically:
  - NEAR: Browser wallet, which is the existing wallet-selector `ft_transfer_call` with the named-account warning.
  - Any other chain: Address or QR, which is the existing refund-address, NEAR-account and quote form, with the deposit panel.
  - The other tile stays visible but disabled, with a one-line reason.
- When the relay offers no other chain, or its asset list fails to load, the list shows NEAR alone.
- The "Pay with" heading and the old tile-first layout go away.
- Not included: paying from an EVM wallet (MetaMask and similar) on Ethereum, Arbitrum or Base. That tile stays disabled for now.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `payer-checkout`: a new "Choose the network first" requirement. "Pay with a NEAR wallet" and "Pay from another chain" now start from the network pick, and the chain-list scenarios move to the new requirement.

## Impact

- `web/src/checkout/Checkout.tsx`: the right column's state changes from `mode` to the picked network and the method. `PayWith` becomes method tiles with a disabled state.
- `web/src/checkout/CrossChainPay.tsx`: the chain list moves out into a shared network list, so this component receives the picked asset instead of owning the list.
- `web/src/checkout/logic.ts` and `logic.test.ts`: a pure rule mapping a network to its methods, with tests.
- No relay, API or contract change.
