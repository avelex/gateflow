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
The Invoices screen SHALL list the gateway's invoices newest first with id, payer, amount and token, a time and status, and SHALL filter by All, Open, Paying, Paid, Returned and Expired, where Expired means Open past its expiry. The payer SHALL be one shortened address with a copy action and, when its chain is known, an explorer link. The time SHALL carry no label: the close time for a Paid or Returned invoice, the expiry for any other, and a dash for a Paid or Returned invoice whose close time is unknown.

#### Scenario: Expired filter
- **WHEN** an Open invoice's expiry has passed
- **THEN** it appears under Expired and not under Open

#### Scenario: Paid invoice time
- **WHEN** invoice 4 was paid and its payment closed at 2026-11-05 05:50 UTC
- **THEN** its row shows "2026-11-05 05:50" and not its expiry

#### Scenario: Close time unknown
- **WHEN** a Paid invoice's payment has no close time
- **THEN** its row shows "—" as the time

#### Scenario: Cross-chain payer
- **WHEN** invoice 6 was paid from `0x200f…7414` on Arbitrum
- **THEN** its row shows `0x200f…7414` with a copy action and a link to the address on Arbiscan, without the chain name

#### Scenario: NEAR payer
- **WHEN** an invoice was paid directly by `alice.near`
- **THEN** its row shows `alice.near` linked to the account on NearBlocks

#### Scenario: Copy without opening
- **WHEN** Kaja uses the payer's copy action or explorer link in a row
- **THEN** the invoice modal does not open

#### Scenario: No memo column
- **WHEN** Kaja views the Invoices screen
- **THEN** the list has no memo column

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
The console SHALL present amounts in token units with the relay's display symbols and SHALL NOT show gas, yoctoNEAR or nonces, and SHALL show transaction hashes only in the invoice modal's Passport tab.

#### Scenario: Invoice details
- **WHEN** Kaja opens an invoice in `nbtc.bridge.near`
- **THEN** amounts show as `0.01 BTC`, and transaction hashes appear only on the Passport tab

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
The invoice modal's Passport tab SHALL show an Invoice group (memo when set, token contract, payment id) and, once the invoice has a payment, a Screening group: the flow (direct or cross-chain), the risk limit the payment was screened against, the deposit address for a cross-chain payment, the OutLayer project, and, when evidence exists, the outcome, the attestation (the request id, linked to its attestation or to OutLayer executions) and the NEAR explorer transaction. It SHALL NOT show the wasm hash, run time or cost.

#### Scenario: Settled direct payment
- **WHEN** Kaja opens the Passport tab of a Paid invoice whose payment was screened as request 2792
- **THEN** the Screening group shows flow Direct, the risk limit, project `ops.gateflow.near/gateflow`, outcome Approved, attestation 2792 and the transaction link, and no wasm hash, run time or cost

#### Scenario: Cross-chain payment
- **WHEN** Kaja opens the Passport tab of an invoice whose payment has a 1Click `ref`
- **THEN** the Screening group shows flow Cross-chain and the deposit address

#### Scenario: Attestation linked
- **WHEN** the payment's evidence has `jobId` 1255332 and request id 2796
- **THEN** the Attestation field shows 2796 and links to `https://app.outlayer.ai/attestation/1255332?network=mainnet` instead of OutLayer executions

#### Scenario: Returned without a verdict
- **WHEN** Kaja opens the Passport tab of a Returned invoice whose screening outcome is `no_verdict`
- **THEN** the Screening group says no verdict arrived within 15 minutes and shows no attestation

#### Scenario: Evidence unavailable
- **WHEN** the invoice's payment has no recorded screening transaction
- **THEN** the Screening group shows flow, risk limit and project, and says the screening record is unavailable

#### Scenario: Timeline by default
- **WHEN** Kaja opens an invoice
- **THEN** the Timeline tab is selected and no request id or hash is visible

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

### Requirement: Invoice modal timeline
The invoice modal SHALL show the invoice id and status, Copy payment link, Open checkout and Close in its header, then the amount and the payer (shortened address with copy and explorer link, or "Not paid yet"), then Timeline and Passport tabs. The Timeline tab SHALL list what happened to the payment with UTC times where known: the deposit (cross-chain only), held in the contract, the screening outcome with an Attestation link when OutLayer's job id is known, and Released to you or Returned to payer with a transaction link. An unpaid invoice SHALL show one step: waiting for payment (or expired unpaid) with the expiry.

#### Scenario: Paid cross-chain invoice
- **WHEN** Kaja opens invoice 6, paid from Arbitrum and closed at 2026-11-05 08:09 UTC
- **THEN** the Timeline shows Deposit detected on Arbitrum, Held in your contract, Screened: approved with an Attestation link, and Released to you at 2026-11-05 08:09

#### Scenario: Screening in progress
- **WHEN** an invoice's payment is Pending
- **THEN** the screening and release steps show as not done, and the release step has no transaction link

#### Scenario: Returned invoice
- **WHEN** an invoice's payment was Refunded after a rejected screening
- **THEN** the last two steps are Screened: rejected and Returned to payer

#### Scenario: Unpaid invoice
- **WHEN** Kaja opens an Open invoice that expires at 2030-01-06 03:20 UTC
- **THEN** the payer reads "Not paid yet" and the Timeline shows Waiting for payment with 2030-01-06 03:20

### Requirement: Invoice modal scrolls
The invoice modal SHALL scroll when its content is taller than the window, and SHALL keep the page behind it fixed.

#### Scenario: Passport tab open
- **WHEN** Kaja opens the Passport tab of an invoice in a 700 px tall window
- **THEN** she can scroll the modal to the Screening group's last row
