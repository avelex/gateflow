# Spec Delta

## MODIFIED Requirements

### Requirement: Console layout
The console SHALL show a collapsible sidebar with Home, Invoices, Balance, Screening (with a count of Pending payments), Search, a Recents list of the merchant's latest chat threads, and the merchant's name and email, with a profile menu offering Settings and Sign out, in the ported Gateflow design.

#### Scenario: Pending count
- **WHEN** Kaja's gateway has 2 Pending payments
- **THEN** the Screening item shows 2

#### Scenario: Recent chat reopened
- **WHEN** Kaja clicks a thread under Recents
- **THEN** the chat view opens with that thread's messages

#### Scenario: Balance opened
- **WHEN** Kaja clicks Balance in the sidebar
- **THEN** the Balance screen opens at `/balance`

## ADDED Requirements

### Requirement: Balance
The Balance screen SHALL name the gateway's payout account and list every allowlisted token, including tokens switched off in Settings and tokens with nothing to show. Each row SHALL show three amounts in token units: Available (the payout account's balance of that token), In screening (the sum of the gateway's Pending payments) and Stuck (the sum of its SettleFailed payments). The screen SHALL be read-only.

#### Scenario: Amounts per token
- **WHEN** Kaja's payout account holds 40 USDC, a 10 USDC payment is Pending and a 5 USDC payment is SettleFailed
- **THEN** the USDC row shows 40 USDC available, 10 USDC in screening and 5 USDC stuck

#### Scenario: Payer's money not counted
- **WHEN** a 3 USDC payment is RefundFailed
- **THEN** it is not counted in any USDC amount on the Balance screen

#### Scenario: Token switched off
- **WHEN** Kaja has switched ZEC off and her payout account holds 2 ZEC
- **THEN** the ZEC row still shows 2 ZEC available

#### Scenario: Empty token
- **WHEN** an allowlisted token has no balance and no Pending or SettleFailed payments
- **THEN** its row shows zero available and no screening or stuck amount

### Requirement: Balance actions
Each Balance row SHALL open the Invoices screen. A row with a Stuck amount SHALL link to that payment on the Screening screen, where it can be retried.

#### Scenario: Stuck payment followed
- **WHEN** Kaja clicks the Stuck amount of the ZEC row
- **THEN** the Screening screen opens on the Failed tab

### Requirement: Balance read endpoint
The backend SHALL return, for the session's gateway, each allowlisted token with its symbol, decimals and the payout account's balance as read from the token contract. Without a session it SHALL answer 401, and before onboarding is finished it SHALL answer 409.

#### Scenario: No session
- **WHEN** a request for balances carries no session cookie
- **THEN** the backend answers 401

#### Scenario: Balances returned
- **WHEN** Kaja's payout account holds 40 USDC
- **THEN** the USDC entry carries the raw balance `40000000` with 6 decimals and symbol USDC
