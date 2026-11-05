# merchant-console Specification

## Purpose

Defines what a signed-in merchant sees and does in the Gateflow console: issue and track invoices, follow screening outcomes, and adjust settings, all in plain payment language without wallets, gas or transaction details.

## Requirements

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

### Requirement: Home
Home SHALL greet the merchant, show today's settled totals per token, and show the assistant composer with hint chips ("Create invoice for 0.01 BTC", "Which invoices are unpaid?", "What was returned this week?", "Lower my risk tolerance"). Sending from Home SHALL open a new thread in the chat view.

#### Scenario: Settled today
- **WHEN** two USDC payments of 10 and 5 settled today
- **THEN** Home shows 15 USDC processed today

#### Scenario: Hint chip
- **WHEN** Kaja clicks "Which invoices are unpaid?"
- **THEN** a new thread opens with that message and the assistant's answer

### Requirement: Create an invoice
The Invoices screen SHALL let the merchant create an invoice from token, amount, expiry (1 hour, 24 hours or 7 days) and optional memo. Confirming SHALL trigger one passkey prompt, and on success the console SHALL show the invoice with its checkout link `<PUBLIC_URL>/pay/<id>` and a copy action.

#### Scenario: Invoice for 0.01 BTC
- **WHEN** Kaja creates an invoice for 0.01 nBTC expiring in 1 hour and confirms the passkey prompt
- **THEN** the console shows the new invoice as Open with its checkout link

#### Scenario: Passkey cancelled
- **WHEN** Kaja cancels the passkey prompt
- **THEN** no invoice is created and the form keeps its values

### Requirement: Invoice list
The Invoices screen SHALL list the gateway's invoices newest first with id, payer, amount and token, memo, a time and status, and SHALL filter by All, Open, Paying, Paid, Returned and Expired, where Expired means Open past its expiry. The time SHALL be the close time for a Paid or Returned invoice whose close time is known, and the expiry otherwise, labeled so the two cannot be confused.

#### Scenario: Expired filter
- **WHEN** an Open invoice's expiry has passed
- **THEN** it appears under Expired and not under Open

#### Scenario: Paid invoice time
- **WHEN** invoice 4 was paid and its payment closed at 2026-11-05 05:50 UTC
- **THEN** its row shows "Paid 2026-11-05 05:50" and not its expiry

#### Scenario: Close time unknown
- **WHEN** a Paid invoice's payment has no close time
- **THEN** its row shows the expiry, labeled as the expiry

### Requirement: Screening view
The Screening screen SHALL list the gateway's payments in tabs Pending, Refunded and Failed (`SettleFailed` or `RefundFailed`) with amount, token, invoice, payer and age, show counts per tab, and offer Retry on Failed payments.

#### Scenario: Failed payment retried
- **WHEN** Kaja presses Retry on a `RefundFailed` payment
- **THEN** the console requests the retry and the payment leaves the Failed tab once it is `Refunded`

### Requirement: Gateway settings
Settings SHALL show the payout account, the fuel level as a plain status (Ready or Topping up), and a risk tolerance control mapped to `max_risk` from 0 to 80. Changing the risk tolerance SHALL trigger one passkey prompt and a relayed `set_policy`.

#### Scenario: Stricter screening
- **WHEN** Kaja lowers risk tolerance to 20 and confirms the passkey prompt
- **THEN** the gateway's `max_risk` becomes 20

### Requirement: Accepted tokens and chains
Settings SHALL list the allowlisted tokens with a toggle per token and the payer origins (NEAR, the configured EVM chains, Bitcoin, Zcash) read-only. Toggles SHALL be stored as a backend preference and limit the tokens offered when creating invoices; they SHALL NOT change the contract.

#### Scenario: Token switched off
- **WHEN** Kaja switches ZEC off
- **THEN** the invoice form no longer offers ZEC

### Requirement: Search
Search (shortcut Cmd/Ctrl+K) SHALL find the merchant's invoices, payments and chat threads by id, amount, token, memo, payer or thread title, and open the matching item. With no match, pressing Enter SHALL ask the assistant the query in a new thread.

#### Scenario: Find by amount
- **WHEN** Kaja searches "0.01"
- **THEN** invoices and payments of amount 0.01 are listed

#### Scenario: Ask instead
- **WHEN** Kaja's search has no matches and she presses Enter
- **THEN** a new thread opens with her query as the first message

### Requirement: No chain vocabulary by default
The console SHALL present amounts in token units with the relay's display symbols and SHALL NOT show gas, yoctoNEAR, nonces or transaction hashes except in an expandable details section.

#### Scenario: Invoice details
- **WHEN** Kaja opens an invoice in `nbtc.bridge.near`
- **THEN** amounts show as `0.01 BTC`, and transaction hashes appear only after expanding Details

### Requirement: Ask about invoices
The Invoices screen SHALL offer an input "Ask about invoices" that sends its text to the assistant in a new thread and opens the chat view.

#### Scenario: Question from Invoices
- **WHEN** Kaja types "Which invoices are unpaid for more than 24 h?" in the Invoices input
- **THEN** the chat view opens with that question and the answer

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

### Requirement: Invoice screening details
The invoice's expandable Details section SHALL show a Screening block once the invoice has a payment: the flow (direct or cross-chain), the risk limit the payment was screened against, the deposit address for a cross-chain payment, the OutLayer project, and, when evidence exists, the outcome, request id, wasm hash, run time, cost in NEAR, and links to the NEAR explorer transaction and to OutLayer executions.

#### Scenario: Settled direct payment
- **WHEN** Kaja expands Details on a Paid invoice whose payment was screened as request 2792 by wasm `11a4ef…` in 1410 ms
- **THEN** the Screening block shows flow Direct, the risk limit, project `ops.gateflow.near/gateflow`, outcome Approved, request 2792, wasm `11a4ef…`, 1.4 s, the cost, and both links

#### Scenario: Cross-chain payment
- **WHEN** Kaja expands Details on an invoice whose payment has a 1Click `ref`
- **THEN** the Screening block shows flow Cross-chain and the deposit address

#### Scenario: Request linked to its attestation
- **WHEN** the payment's evidence has `jobId` 1255332 and request id 2796
- **THEN** the request field shows 2796 and links to `https://app.outlayer.ai/attestation/1255332?network=mainnet` instead of OutLayer executions

#### Scenario: Returned without a verdict
- **WHEN** Kaja expands Details on a Returned invoice whose screening outcome is `no_verdict`
- **THEN** the Screening block says no verdict arrived within 15 minutes and shows no wasm hash as the screening code

#### Scenario: Evidence unavailable
- **WHEN** the invoice's payment has no recorded screening transaction
- **THEN** the Screening block shows flow, risk limit and project, and says the screening record is unavailable

#### Scenario: Collapsed by default
- **WHEN** Kaja opens an invoice without expanding Details
- **THEN** no wasm hash, request id or cost is visible

### Requirement: Payments carry screening evidence
The console's payments data SHALL include each payment's screening evidence, or null when none is recorded, and, for a cross-chain payment whose origin sender is known, the origin chain and sender addresses.

#### Scenario: Payment list
- **WHEN** the console loads the gateway's payments and payment 3 has stored evidence
- **THEN** payment 3's entry carries that evidence

#### Scenario: Origin sender included
- **WHEN** payment 3 came from a Base quote whose stored senders are `["0x12ab…cd"]`
- **THEN** payment 3's entry carries origin chain `base` and senders `["0x12ab…cd"]`

### Requirement: Payer of a payment
The console SHALL name a payment's payer as follows:
- A direct payment: the account that paid.
- A cross-chain payment with a known origin sender: the shortened first sender address and the origin chain name, plus the count of further senders.
- Otherwise: the NEAR refund account.

#### Scenario: Paid from Base
- **WHEN** a payment has a `ref` and origin sender `0x12ab34…56cd` on `base`
- **THEN** the payer shows as `0x12ab…56cd on Base`

#### Scenario: Bitcoin with three inputs
- **WHEN** a payment's origin senders are three Bitcoin addresses
- **THEN** the payer shows the first shortened address, "on Bitcoin" and "+2"

#### Scenario: Sender not resolved
- **WHEN** a payment has a `ref`, sender `intents.near`, refund account `bob.near` and no known origin sender
- **THEN** the payer shows as `bob.near`, never `intents.near`

#### Scenario: Direct payment
- **WHEN** a payment has no `ref` and sender `alice.near`
- **THEN** the payer shows as `alice.near`

### Requirement: Invoice card close time
The invoice card SHALL show "paid <time> UTC" for a Paid invoice and "returned <time> UTC" for a Returned invoice when the close time is known, in place of its expiry.

#### Scenario: Paid card
- **WHEN** Kaja opens invoice 4, which closed at 2026-11-05 05:50 UTC
- **THEN** the card says "paid 2026-11-05 05:50 UTC" and shows no expiry

### Requirement: Invoice modal scrolls
The invoice modal SHALL scroll when its content is taller than the window, and SHALL keep the page behind it fixed.

#### Scenario: Details expanded
- **WHEN** Kaja expands Details on an invoice in a 700 px tall window
- **THEN** she can scroll the modal to its Copy payment link button
