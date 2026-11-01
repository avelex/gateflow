# Spec Delta

## ADDED Requirements

### Requirement: Checkout invoice details
`GET /checkout/invoice?id=<invoice id>` SHALL return the invoice's amount, token symbol and decimals, expiry, status and gateway, the merchant's display name, and, when the invoice has a payment, that payment's status and refund account. It SHALL answer 404 for an unknown invoice.

#### Scenario: Paying invoice
- **WHEN** the page requests an invoice whose payment is Pending
- **THEN** the response has invoice status `Paying` and payment status `Pending`

#### Scenario: Unknown invoice
- **WHEN** the page requests an invoice id that does not exist
- **THEN** the relay answers 404

### Requirement: Quotable origin assets
`GET /checkout/assets` SHALL return the 1Click assets whose chain can be screened (the configured EVM chains, Bitcoin and Zcash) with asset id, chain and symbol.

#### Scenario: Solana excluded
- **WHEN** the page requests quotable assets
- **THEN** the list contains Bitcoin BTC and no Solana asset

### Requirement: Backend-driven deferred screening
The backend SHALL record each quote it issues with its `ref`, deposit address, invoice and deadline, poll 1Click for its status, and once the status is `SUCCESS` and a payment with that `ref` exists, submit `screen_intents` itself. It SHALL stop polling a quote after screening was submitted, after 1Click reports `REFUNDED` or `FAILED`, or one hour after the quote deadline.

#### Scenario: Payer closed the tab
- **WHEN** the payer sends the deposit and closes the page, and 1Click later reports `SUCCESS`
- **THEN** the backend submits `screen_intents` for that payment without any page request

#### Scenario: Swap refunded by 1Click
- **WHEN** 1Click reports `REFUNDED` for a recorded quote
- **THEN** the backend stops polling it and submits nothing

### Requirement: Quote status for the page
`GET /checkout/status?depositAddress=` SHALL return the 1Click status of a recorded quote together with whether the backend has submitted screening for it.

#### Scenario: Screening submitted
- **WHEN** the page polls a deposit address whose screening the backend submitted
- **THEN** the response carries the 1Click status `SUCCESS` and `screening: true`
