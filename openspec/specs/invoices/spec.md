# invoices Specification

## Purpose

Lets a merchant issue on-chain invoices that fix the token, amount and expiry a payer must match, and tracks each invoice from issue to paid or returned so the console can list unpaid and settled invoices.

## Requirements

### Requirement: Owner creates an invoice
The system SHALL let only the gateway owner call `create_invoice(gateway, token, amount, expires_in_sec, memo?)`. It SHALL store an Open invoice with the gateway, token, amount, expiry time (now plus `expires_in_sec`) and memo, deduct the storage the invoice uses from the gateway's fuel, emit `invoice_created`, and return a new sequential invoice id. The invoice SHALL NOT hold payer data.

#### Scenario: Invoice created
- **WHEN** the owner of gateway 0 creates an invoice for 10 USDC that expires in 3600 seconds
- **THEN** the call returns the next invoice id and `get_invoice` returns it as Open with expiry one hour after creation

#### Scenario: Non-owner rejected
- **WHEN** an account other than the gateway owner calls `create_invoice`
- **THEN** the call fails with "not the gateway owner"

#### Scenario: Storage paid from fuel
- **WHEN** the owner creates an invoice on a gateway with 0.05 NEAR of fuel
- **THEN** the gateway's fuel drops by the storage cost of that invoice

#### Scenario: Not enough fuel for storage
- **WHEN** the gateway's fuel is below the invoice's storage cost
- **THEN** the call fails with "gateway has no fuel for invoice storage" and no invoice is created

### Requirement: Invoice input validation
The system SHALL reject an invoice whose token is not on the token allowlist, whose amount is zero, whose `expires_in_sec` is below 60 or above 2 592 000 (30 days), or whose memo is longer than 140 bytes.

#### Scenario: Token not allowed
- **WHEN** the owner creates an invoice in a token that is not allowlisted
- **THEN** the call fails with "token not accepted"

#### Scenario: Expiry too long
- **WHEN** the owner creates an invoice with `expires_in_sec = 3 000 000`
- **THEN** the call fails with "invalid expiry"

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

### Requirement: Invoice lifecycle follows its payment
When a payment opens against an invoice, the invoice SHALL become Paying and record the payment id. When that payment is approved the invoice SHALL become Paid. When that payment is refunded for any reason, including `reclaim`, the invoice SHALL become Returned. Paid and Returned are final. A payment refunded at delivery SHALL NOT change the invoice.

#### Scenario: Approved
- **WHEN** screening approves the payment of an invoice
- **THEN** the invoice becomes Paid

#### Scenario: Rejected
- **WHEN** screening rejects the payment of an invoice
- **THEN** the invoice becomes Returned and accepts no further payment

#### Scenario: Second payment while Paying
- **WHEN** a payment without a `ref` arrives for an invoice that is Paying
- **THEN** the call fails with "invoice is not open"

### Requirement: Expiry is derived
The system SHALL keep an unpaid invoice Open after its expiry time and SHALL treat an Open invoice whose expiry time has passed as expired: it accepts no payment. Clients SHALL read expiry from the invoice's expiry time.

#### Scenario: Read after expiry
- **WHEN** `get_invoice` is called for an unpaid invoice past its expiry
- **THEN** it returns status Open with an expiry time in the past

### Requirement: Invoice lookup
The system SHALL expose a read-only view returning an invoice's gateway, token, amount, expiry time, memo, status and payment id, or nothing for an unknown id.

#### Scenario: Unknown invoice
- **WHEN** `get_invoice` is called with an id that was never created
- **THEN** it returns null

### Requirement: Invoices by gateway
The system SHALL expose a read-only view `get_invoices(gateway, from_index, limit)` returning `[id, invoice]` pairs of that gateway in creation order, starting at position `from_index`, with at most `min(limit, 100)` entries. An unknown gateway or a position past the end SHALL return an empty list.

#### Scenario: Page of invoices
- **WHEN** gateway 0 has 5 invoices and `get_invoices(0, 3, 10)` is called
- **THEN** it returns the 4th and 5th invoices of gateway 0

#### Scenario: Limit capped
- **WHEN** `get_invoices` is called with `limit = 500`
- **THEN** it returns at most 100 entries
