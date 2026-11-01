# Spec Delta

## MODIFIED Requirements

### Requirement: Owner creates an invoice
The system SHALL let only the gateway owner call `create_invoice(gateway, token, amount, expires_in_sec, memo?)`. It SHALL store an Open invoice with the gateway, token, amount, expiry time (now plus `expires_in_sec`) and memo, emit `invoice_created`, and return a new sequential invoice id. The invoice SHALL NOT hold payer data.

#### Scenario: Invoice created
- **WHEN** the owner of gateway 0 creates an invoice for 10 USDC that expires in 3600 seconds
- **THEN** the call returns the next invoice id and `get_invoice` returns it as Open with expiry one hour after creation

#### Scenario: Non-owner rejected
- **WHEN** an account other than the gateway owner calls `create_invoice`
- **THEN** the call fails with "not the gateway owner"

### Requirement: Payment must match its invoice
A payment SHALL be accepted only when the invoice its `msg` names exists, is Open, has not expired, and the payment's token and amount equal the invoice's token and amount. The payment SHALL belong to the invoice's gateway.

#### Scenario: Exact payment
- **WHEN** 10 USDC arrive with `msg = {"invoice":3}` for Open, unexpired invoice 3 of 10 USDC on gateway 0
- **THEN** a payment opens against invoice 3 on gateway 0

#### Scenario: Wrong amount without ref
- **WHEN** 9 USDC arrive without a `ref` for an invoice of 10 USDC
- **THEN** the call fails with "amount does not match the invoice" and the funds return to the sender

#### Scenario: Expired invoice with ref
- **WHEN** a payment with a `ref` from `intents.near` arrives for an invoice past its expiry
- **THEN** the payment opens and is refunded in the same call, and the invoice stays Open
