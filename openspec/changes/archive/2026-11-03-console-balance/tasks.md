# Tasks

Spec: `specs/merchant-console/spec.md`. Design: `design.md`.

Review focus. These are inputs the spec implies but no other test covers:
- Payout account has no storage on a token: `ft_balance_of` returns `"0"` and the row shows zero (task 1.1).
- `RefundFailed`, `Settled` and `Refunded` payments must never count toward any amount (task 2.1).
- Two Pending payments of the same token sum. Different tokens never mix (task 2.1).
- A token switched off in Settings still has a row (task 1.1 returns it; task 3.2 renders it).
- No SettleFailed payment means no Stuck link, so there is nothing broken to click (task 3.2).

## 1. Relay: balances endpoint

- [x] 1.1 Add `GET /console/balances` to `relay/src/console.ts`.
  - **Handler:** `requireGateway`, then `readGateway`, then `get_tokens`. For each token, in parallel, call `ft_balance_of({ account_id: payout_to })` and `tokenMeta`.
  - **Response:** `[{ token, symbol, decimals, balance }]` in allowlist order, where `balance` is the raw string.
  - **Tests**, in `relay/src/console.test.ts`, using `withGateway`. Set these view-table entries:
    - `"usdc.testnet.ft_metadata"` to `{ symbol: "USDC", decimals: 6 }`, overriding the fixture's 24 decimals
    - `"usdc.testnet.ft_balance_of"` to `"40000000"`
    - `"wrap.testnet.ft_balance_of"` to `"0"`
  - **Test cases:**
    - `balances_need_session`: no cookie gives 401.
    - `balances_need_gateway`: an onboarded account without a gateway gives 409.
    - `balances_of_payout`: returns `{ token: "usdc.testnet", symbol: "USDC", decimals: 6, balance: "40000000" }`, and the `wrap.testnet` entry with `balance: "0"`. The recorded `views` show `ft_balance_of` called with `{ account_id: "kaja-coffee.op.testnet" }`.
    - `balances_include_switched_off`: after `PUT /console/preferences { tokensOff: ["usdc.testnet"] }`, USDC is still returned.
  - **Verify:** `cd relay && npm test` passes.

## 2. Web: data and sums

- [x] 2.1 Add `heldByToken(payments: Payment[], status: "Pending" | "SettleFailed"): Map<string, bigint>` to `web/src/console/logic.ts`, next to `settledToday`. It returns raw sums keyed by `payment.token`.
  - **Test** `held_by_token`, in `web/src/console/logic.test.ts`, using the `pay` fixture:
    - Pending `10000000` and `5000000` on `usdc.near` sum to `15000000n`.
    - A Pending nBTC payment on another token stays separate.
    - `RefundFailed`, `Settled` and `Refunded` payments are excluded.
    - With status `SettleFailed`, only SettleFailed payments are counted.
  - **Verify:** `cd web && npx vitest run src/console/logic.test.ts`.
- [x] 2.2 Load balances in the existing poll.
  - **Type:** add `export type Balance = { token: string; symbol: string; decimals: number; balance: string }` to `web/src/console/Layout.tsx`.
  - **Data:** add `balances: Balance[]` to `ConsoleData`, and add `api<Balance[]>("GET", "/console/balances")` to `load()`.
  - **Verify:** `cd web && npx tsc --noEmit` passes.

## 3. Web: route, sidebar and screen

- [x] 3.1 Route `/balance`.
  - Add `"/balance": "balance"` to `TABS` and `"balance"` to the `tab` union in `web/src/App.tsx`.
  - Add the sidebar item `{ label: "Balance", icon: "wallet", key: "balance" }` in `Layout.tsx`, after Invoices, navigating to `/balance`.
  - Extend `route_of` in `web/src/App.test.ts` with `expect(route("/balance")).toEqual({ page: "console", tab: "balance" })`.
  - **Verify:** `cd web && npx vitest run src/App.test.ts`.
- [x] 3.2 Create `web/src/console/Balance.tsx` (`ScreenProps`) and register it under `screens.balance` in `Console.tsx`.
  - **Port:** the Balance header and table from `design/Gateflow Console.html`, restricted to the scope in `design.md`, Screen layout.
  - **Copy:** the title is "Balance". The subtitle names `data.gateway.payout_to`.
  - **Columns:** Token (logo from `tokenIcon`), Available, In screening, Stuck.
  - **Amounts:** use `formatAmount` with the token's decimals. Show `—` when the screening or stuck sum is zero.
  - **Clicks:**
    - A row opens `/invoices`.
    - The Stuck amount opens `/screening#payment-<id>` for the oldest SettleFailed payment of that token, with `stopPropagation` so the row click doesn't also fire.
  - **Verify:** `cd web && npm run build` passes. In `npm run dev` against a seeded relay:
    - the sidebar shows Balance after Invoices
    - `/balance` lists every allowlisted token
    - clicking a Stuck amount lands on the Screening Failed tab

## 4. Integration check

- [x] 4.1 Run `cd relay && npm test` and `cd web && npm test`, and confirm both pass. Then run `openspec validate console-balance` and confirm it passes.
