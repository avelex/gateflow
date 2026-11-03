# Design

## Context

- `Layout.tsx` polls the console every 15 s and loads me, gateway (including `payout_to`), invoices, payments (with `tokenMeta`), tokens and threads. Every screen receives this as `ScreenProps.data`.
- `settledToday` in `console/logic.ts` already sums payments per token. "In screening" and "Stuck" are the same calculation with a different status filter.
- Nothing reads the payout account today. Settled funds leave the contract for `payout_to` as NEP-141 tokens (`merchant-gateways`: "Payout is a NEAR account").
- `relay/src/console.ts` has `tokens` (allowlist plus `tokenMeta`) and `requireGateway` (401 without a session, 409 before onboarding is finished).
- Screening opens on the payment's tab when the URL hash is `#payment-<id>`. Search already uses this.

## Goals / Non-Goals

**Goals:**
- One new relay read and one new screen. Reuse the Layout poll and the existing helpers.

**Non-Goals:**
- Caching balances, new database state, a contract view, or fiat values.

## Decisions

### Separate `GET /console/balances` instead of extending `/console/tokens`
`/console/tokens` only needs the session, and Settings uses it before a gateway exists. Balances need the gateway's `payout_to` and so belong behind `requireGateway`. The new handler calls `readGateway`, then `get_tokens`, then `ft_balance_of({ account_id: payout_to })` per token, in parallel, plus `tokenMeta`. It returns `[{ token, symbol, decimals, balance }]`, with `balance` as the raw string.

Alternative: put `balance` on every `/console/tokens` entry. Rejected because it ties a gateway-scoped read to a session-scoped one.

### Load balances in the Layout poll
Add `/console/balances` to `load()` in `Layout.tsx` and to `ConsoleData`. It refreshes with everything else and keeps one data path for every screen. The cost is one extra view per allowlisted token every 15 s, which is acceptable for three tokens.

Alternative: load it only on the Balance screen. Rejected because it needs a second poll hook and loading state for a small gain.

### Client-side per-token sums
Add `heldByToken(payments, status)` to `console/logic.ts` next to `settledToday`. It returns raw `bigint` sums keyed by token, and the screen formats them with `formatAmount`. "In screening" uses `Pending`, "Stuck" uses `SettleFailed`, and `RefundFailed` is excluded on purpose.

### Rows come from the balances response
The allowlist decides the rows, so a token switched off in Settings still shows its funds. If a Pending payment's token is no longer allowlisted, it is not shown. That can only happen if the operator removes a token while payments are in flight, and Screening still lists those payments.

### Navigation
Add `/balance` to `TABS` in `App.tsx` and `"balance"` to the console `Route` tab union, rendered through `screens` in `Console.tsx`. The sidebar item uses the `wallet` icon and sits after Invoices, as in the design export.
- Row click: `navigate("/invoices")`.
- Stuck amount: `navigate("/screening#payment-<id>")` with the oldest `SettleFailed` payment of that token, which opens the Failed tab.

### Screen layout
Port the design export's Balance header and table, but only the parts in scope:
- Title "Balance", plus a subtitle that names the payout account.
- Table columns: Token | Available | In screening | Stuck.
- Token logos come from `assets.ts`, as elsewhere.
- Dropped: total value, currency toggle, Export, Refresh (the poll covers refreshing), Price/Weight/Value columns and the per-network rows.

## Risks / Trade-offs

- [Payout account has no storage on a token] → NEP-141 `ft_balance_of` returns `"0"` for unknown accounts, so the row shows zero. No special case.
- [One token contract view fails] → The whole `/console/balances` request fails, and the console shows its usual error state. This matches how `/console/tokens` handles a failing `ft_metadata`. Per-token error rows can wait until this happens in practice.
- [Extra RPC load] → One view per token per poll per open console. Acceptable for a demo-scale merchant count.

## Migration Plan

None. The change adds a read endpoint and a screen. Roll back by reverting.
