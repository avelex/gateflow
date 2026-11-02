# Spec Delta

## MODIFIED Requirements

### Requirement: Checkout invoice details
`GET /checkout/invoice?id=<invoice id>` SHALL return the invoice's amount, token symbol and decimals, expiry, status and gateway, the merchant's display name, the Gateflow contract account, and, when the invoice has a payment, that payment's status and refund account. It SHALL answer 404 for an unknown invoice.

#### Scenario: Paying invoice
- **WHEN** the page requests an invoice whose payment is Pending
- **THEN** the response has invoice status `Paying` and payment status `Pending`

#### Scenario: Unknown invoice
- **WHEN** the page requests an invoice id that does not exist
- **THEN** the relay answers 404

#### Scenario: Contract account included
- **WHEN** the relay runs with `GATEFLOW_CONTRACT` `gateflow.near` and the page requests an Open invoice
- **THEN** the response's `contract` is `gateflow.near`
