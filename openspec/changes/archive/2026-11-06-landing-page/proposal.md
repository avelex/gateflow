# Proposal

## Why

Judges and first-time visitors who open the Gateflow URL land on a bare sign-in card. Nothing tells them what Gateflow is: Stripe-style crypto checkout for any business, live in minutes, with no crypto backend, built-in payer screening and self-custody. The hackathon demo needs a page that makes that clear in a few seconds.

## What Changes

- A signed-out visitor at a console path (`/`, `/invoices`, ...) sees a landing deck instead of the sign-in card. The deck has five full-viewport slides, and the page never scrolls:
  1. Hook: "Stripe for Web2. Gateflow for Web3." Accept crypto from any chain in a measured number of minutes, with compliance built in, self-custody always, and 6 networks today (33 more coming). A flow shows six networks passing a check into "Your account".
  2. Problem: before/after. Nodes, hot wallets, bridges and a compliance vendor without Gateflow, one payment link with it.
  3. How it works: sign in with email, share a link, and the buyer pays from any of the six networks into the merchant's own account.
  4. Trust: every payer is checked against sanctions and fraud-risk lists in tamper-proof hardware. A buyer, Gateflow, then settle-or-refund fork diagram. Gateflow holds no keys. BYOK for AML and KYT providers is marked "Coming soon".
  5. Developers and calls to action: a syntax-highlighted widget snippet, "Launch console" and Example shop.
- A "Powered by NEAR" footer appears on every slide. The page shows no network badge.
- Slide controls: arrow keys and space, dots, one slide per wheel gesture, touch swipe, and a `#<n>` hash for each slide. On phones the deck stays a deck with simplified content. Transitions are about 300 ms and turn off under `prefers-reduced-motion`.
- "Launch console" swaps the deck for the existing sign-in card on the same path, with a back link. Signed-in merchants and the post-sign-out screen are unchanged.
- Rules for claims: the copy says "no crypto backend" (no nodes, wallets, bridges or compliance vendor), never "no backend". It claims only what ships today.
- The Example shop link uses `VITE_SHOP_URL` at build time. When that is unset, it points to `examples/shop` on GitHub.

## Capabilities

### New Capabilities

- `landing-page`: the public marketing deck shown to signed-out visitors. It covers slide content, claim rules, navigation, responsive and motion behaviour, and the handoff to sign-in.

### Modified Capabilities

None. No current requirement defines the signed-out view at `/`. The sign-in card, onboarding and the signed-in console keep their requirements.

## Impact

- **Code:** `web/` only. A new landing module and stylesheet, plus a small change to the signed-out branch of `web/src/console/Console.tsx`. It reuses `tokens.css`, `ds.jsx`, the Plex fonts and the chain icons, including the unused `chain-near.png`.
- **Config:** optional `VITE_SHOP_URL` at build time.
- **Relay, contract, enclave:** no change.
- **Out of scope:**
  - reusable payment links, which come next as their own change
  - a "Try a live payment" button, which waits for payment links
  - hosting the example shop
  - BYOK itself
