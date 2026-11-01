# Spec Delta

## Purpose

Defines what a signed-in merchant sees and does in the Gateflow console: issue and track invoices, follow screening outcomes, and adjust settings, all in plain payment language without wallets, gas or transaction details.

## ADDED Requirements

### Requirement: Console layout
The console SHALL show a collapsible sidebar with Home, Invoices, Screening (with a count of Pending payments), Search and the merchant's name and email, with a profile menu offering Settings and Sign out, in the ported Gateflow design.

#### Scenario: Pending count
- **WHEN** Kaja's gateway has 2 Pending payments
- **THEN** the Screening item shows 2

### Requirement: Home
Home SHALL greet the merchant, show today's settled totals per token, and show the assistant composer disabled with the note that the assistant is coming soon.

#### Scenario: Settled today
- **WHEN** two USDC payments of 10 and 5 settled today
- **THEN** Home shows 15 USDC processed today

### Requirement: Create an invoice
The Invoices screen SHALL let the merchant create an invoice from token, amount, expiry (1 hour, 24 hours or 7 days) and optional memo. Confirming SHALL trigger one passkey prompt, and on success the console SHALL show the invoice with its checkout link `<PUBLIC_URL>/pay/<id>` and a copy action.

#### Scenario: Invoice for 0.01 BTC
- **WHEN** Kaja creates an invoice for 0.01 nBTC expiring in 1 hour and confirms the passkey prompt
- **THEN** the console shows the new invoice as Open with its checkout link

#### Scenario: Passkey cancelled
- **WHEN** Kaja cancels the passkey prompt
- **THEN** no invoice is created and the form keeps its values

### Requirement: Invoice list
The Invoices screen SHALL list the gateway's invoices newest first with id, amount and token, memo, expiry time and status, and SHALL filter by All, Open, Paying, Paid, Returned and Expired, where Expired means Open past its expiry.

#### Scenario: Expired filter
- **WHEN** an Open invoice's expiry has passed
- **THEN** it appears under Expired and not under Open

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
Search (shortcut Cmd/Ctrl+K) SHALL find the merchant's invoices and payments by id, amount, token, memo or payer, and open the matching item.

#### Scenario: Find by amount
- **WHEN** Kaja searches "0.01"
- **THEN** invoices and payments of amount 0.01 are listed

### Requirement: No chain vocabulary by default
The console SHALL present amounts in token units with symbols from token metadata and SHALL NOT show gas, yoctoNEAR, nonces or transaction hashes except in an expandable details section.

#### Scenario: Invoice details
- **WHEN** Kaja opens an invoice
- **THEN** amounts show as `0.01 nBTC`, and transaction hashes appear only after expanding Details
