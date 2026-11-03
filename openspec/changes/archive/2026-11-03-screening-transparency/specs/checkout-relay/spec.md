# Spec Delta

## MODIFIED Requirements

### Requirement: Checkout invoice details
`GET /checkout/invoice?id=<invoice id>` SHALL return the invoice's amount, token symbol and decimals, expiry, status and gateway, the merchant's display name, the Gateflow contract account, and, when the invoice has a payment, that payment's status and refund account. It SHALL also return `enclave` with the configured OutLayer project and its active wasm hash, and `screening` with the payment's screening evidence or null. It SHALL answer 404 for an unknown invoice.

#### Scenario: Paying invoice
- **WHEN** the page requests an invoice whose payment is Pending
- **THEN** the response has invoice status `Paying` and payment status `Pending`

#### Scenario: Unknown invoice
- **WHEN** the page requests an invoice id that does not exist
- **THEN** the relay answers 404

#### Scenario: Contract account included
- **WHEN** the relay runs with `GATEFLOW_CONTRACT` `gateflow.near` and the page requests an Open invoice
- **THEN** the response's `contract` is `gateflow.near`

#### Scenario: Enclave facts included
- **WHEN** `outlayer.near` reports active version `11a4ef…` for project `ops.gateflow.near/gateflow` and the page requests an Open invoice
- **THEN** the response's `enclave` is `{project: "ops.gateflow.near/gateflow", activeVersion: "11a4ef…"}` and `screening` is null

#### Scenario: Screened invoice
- **WHEN** the page requests a Paid invoice whose payment has stored evidence
- **THEN** the response's `screening` carries the transaction hash, request id, wasm hash, run time, cost and outcome `approved`

#### Scenario: OutLayer unavailable
- **WHEN** reading the active version fails
- **THEN** the response still returns the invoice with `enclave.activeVersion` null

## ADDED Requirements

### Requirement: Active enclave version is cached
The relay SHALL read the project's active version from the OutLayer contract at most once per 60 seconds and serve the cached value in between.

#### Scenario: Polling page
- **WHEN** a checkout page polls the invoice every 5 seconds for one minute
- **THEN** the relay reads the active version from OutLayer at most twice

### Requirement: Direct payment transaction report
`POST /checkout/tx` with `{invoice, txHash}` SHALL record `txHash` as the screening transaction of the invoice's payment only when the NEAR transaction, looked up with the payment's payer as signer, contains the Gateflow contract's `payment_opened` event for that payment. It SHALL answer 400 for a malformed hash, 404 when the invoice has no payment, and 422 when the transaction does not match.

#### Scenario: Wallet hash accepted
- **WHEN** the page reports the hash of the payer's `ft_transfer_call` that opened payment 3 for invoice 7
- **THEN** the relay records it for payment 3 and answers `{payment: 3}`

#### Scenario: Unrelated transaction
- **WHEN** the page reports a hash whose transaction opened a different payment or none
- **THEN** the relay answers 422 and records nothing

#### Scenario: Not paid yet
- **WHEN** the page reports a hash for an invoice that has no payment yet
- **THEN** the relay answers 404 and records nothing
