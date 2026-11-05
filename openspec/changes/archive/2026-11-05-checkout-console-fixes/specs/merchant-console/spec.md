## MODIFIED Requirements

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

### Requirement: No chain vocabulary by default
The console SHALL present amounts in token units with the relay's display symbols and SHALL NOT show gas, yoctoNEAR, nonces or transaction hashes except in an expandable details section.

#### Scenario: Invoice details
- **WHEN** Kaja opens an invoice in `nbtc.bridge.near`
- **THEN** amounts show as `0.01 BTC`, and transaction hashes appear only after expanding Details

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

## ADDED Requirements

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
