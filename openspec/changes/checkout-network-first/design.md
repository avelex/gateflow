# Design

## Context

See proposal.md for the motivation. The current state that shapes the approach:

- **`Checkout.tsx`:**
  - The right column keeps `mode: "wallet" | "qr"`, defaulting to wallet. `PayWith` renders the two tiles as clickable `<div>`s.
  - Wallet mode shows `NamedWarning` and `NearPayButton`.
  - QR mode renders `CrossChainPay`.
- **`CrossChainPay.tsx`:**
  - It fetches `GET /checkout/assets?invoice=<id>` itself and renders the `ChainRow` list through `chainRows()`.
  - It owns the refund and NEAR-account fields, the quote request and `DepositPanel`.
  - It auto-selects the only asset when there is one.
- **Resume and processing:** a saved quote or a sent wallet payment switches the column to the processing view before any picker shows. That stays unchanged.
- **Icons:** there is no NEAR chain icon among the exports. The letter-circle fallback in `ChainRow` covers it.

## Goals / Non-Goals

**Goals:**
- One state for the column, the picked network, from which the method follows. The network-to-method rule is a pure, tested function.

**Non-Goals:**
- EVM wallet payment. The Browser wallet tile is disabled for non-NEAR networks.
- Changing the quote, deposit or processing views.
- Keyboard roving inside the list. Rows stay buttons in tab order.

## Decisions

1. **The asset list moves up to `Checkout`.**
   - `Checkout` fetches `/checkout/assets?invoice=<id>` once per invoice and treats a failure as `[]`.
   - The network list renders a NEAR row first, then `chainRows(assets)`.
   - NEAR is rendered as its own row rather than passed through `chainRows`, because `chainRows` moves `eth` to the top and NEAR must stay above it.
   - Rejected alternative: keeping the fetch in `CrossChainPay`. The list must render before any method is chosen, so the component that renders it has to own the data.

2. **State is `network: string | undefined`.**
   - `"near"` for NEAR, otherwise the picked `assetId`. The method follows from it, so there is no separate method state.
   - `methodFor(chain: string): "wallet" | "qr"` in `logic.ts` returns `"wallet"` for `near` and `"qr"` otherwise.
   - `blockedReason(chain: string, method: "wallet" | "qr"): string | undefined` returns the disabled tile's reason:
     - Address or QR from NEAR: "NEAR pays from a wallet".
     - Browser wallet from `<Chain>`: "Wallet payment from <Chain> is coming".
   - Rejected alternative: a `mode` state plus a network state. The two could disagree, and with one method per network the choice is never the payer's.

3. **`CrossChainPay` takes the picked asset.**
   - Its props become `{ inv, asset, onQuote, children }`.
   - It drops its own list, fetch and auto-select, and keeps the form, the quote and the footnote.
   - `ChainRow` moves to a `NetworkList` component that `Checkout` renders. It stays in `CrossChainPay.tsx`, beside its only other user, and is exported from there.

4. **`PayWith` becomes method tiles with a disabled state.**
   - Each tile becomes a `<button>` with `aria-pressed`, and `disabled` plus the reason as its subtitle when blocked.
   - The heading changes from "Pay with" to "Pay by".
   - The tiles render only after a network is picked.

5. **Footnote and pay button placement stay as today.**
   - NEAR: the warning and "Connect wallet and pay" sit under the tiles.
   - QR: the fields, then "Get deposit address" at the bottom of the column.

## Risks / Trade-offs

- [The NEAR row shows the letter "N" instead of a logo] → The user can supply `web/src/assets/chain-near.png`, and one line in `CHAINS` wires it.
- [A payer who wants MetaMask sees a disabled Browser wallet tile on EVM chains] → The reason line says the option is coming, and Address or QR works from any wallet.
- [A saved-but-expired quote resumes into the processing view without the list] → This is today's behavior. "Get a new quote" clears it and returns to the list.
