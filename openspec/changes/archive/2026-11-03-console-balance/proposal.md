# Proposal

## Why

Merchants can see what settled today and which payments are in screening, but not how much they hold. The design export (`design/Gateflow Console.html`) now has a Balance screen. A read-only version fits the current model: settled funds sit in the merchant's payout NEAR account, and the contract holds only payments that are still in screening or stuck.

## What Changes

- Add a Balance screen at `/balance`, with a sidebar item after Invoices.
- Show one row per allowlisted token with three amounts in token units:
  - **Available**: the payout account's balance of that token.
  - **In screening**: the sum of the gateway's `Pending` payments.
  - **Stuck**: the sum of the gateway's `SettleFailed` payments. Approved, but not yet paid out.
- Name the payout account on the screen. Link Stuck to Screening and each row to Invoices.
- Add a session-gated relay endpoint `GET /console/balances` that reads `ft_balance_of(payout_to)` per allowlisted token.

Out of scope, each a possible follow-up:
- Fiat prices, a total in EUR/USD, and 24h change.
- Withdraw, statement export, and per-network breakdowns.
- The Gateflow to Deflow rename that is also in the design export.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `merchant-console`: "Console layout" gains a Balance item. A new "Balance" requirement defines the screen's rows and amounts.

## Impact

- **Relay:** one read-only route in `relay/src/console.ts`. No contract change, no new dependency, no new database state.
- **Web:** a new `Balance.tsx` screen, a `/balance` route in `App.tsx`, a sidebar item in `Layout.tsx`, and a pure per-token sum helper in `console/logic.ts`.
- **Behavior:** `RefundFailed` payments belong to the payer and are not counted.
