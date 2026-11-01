# Spec Delta

## MODIFIED Requirements

### Requirement: Payments arrive by ft_transfer_call
The system SHALL accept a payment only as a NEP-141 `ft_transfer_call` whose `msg` is JSON `{"gateway": <id>, "refund_to"?: <account>, "ref"?: <string>, "invoice"?: <id>}`, from an allowlisted token contract, for a non-zero amount. It SHALL keep the full amount and return no unused tokens.

#### Scenario: Wrong token rejected
- **WHEN** a token that is not on the allowlist calls `ft_on_transfer`
- **THEN** the call fails with "token not accepted" and the token contract returns the funds to the sender

#### Scenario: Malformed msg rejected
- **WHEN** `msg` is not valid gateway JSON
- **THEN** the call fails and the funds return to the sender

#### Scenario: Payment without invoice
- **WHEN** 5 USDC arrive with `msg = {"gateway":0}` and USDC is allowlisted
- **THEN** the payment opens without an invoice

### Requirement: Payment opened and screened
On accepting a payment without a `ref`, the system SHALL record it as Pending with payer, refund account (`refund_to` or the sender), token, amount, invoice if any, open time and the gateway's `max_risk`, log `OPENED`, and request one TEE screening of the NEAR sender account against `max_risk`.

#### Scenario: Screening requested
- **WHEN** a valid payment without a `ref` arrives
- **THEN** the payment is Pending and an OutLayer execution runs with `{"kind":"screen","payer":<sender>,"max_risk":<n>}`

### Requirement: Ref payments open without screening
On accepting a payment with a `ref`, the system SHALL record it as Pending with its `ref`, payer, refund account, token, amount, invoice if any, open time and the gateway's `max_risk`, log `OPENED`, and SHALL NOT request screening. A `ref` SHALL be unique across payments.

#### Scenario: 1Click delivery recorded
- **WHEN** 1Click delivers 10 USDC with `msg = {"gateway":0,"ref":"r1","refund_to":"bob.near"}`
- **THEN** the payment is Pending with `ref = "r1"`, no OutLayer execution runs, and no fuel is deducted

#### Scenario: Duplicate ref
- **WHEN** a second payment arrives with a `ref` already used by another payment
- **THEN** the payment opens and is refunded in the same call

### Requirement: Ref payments never fail at delivery
For a payment with a `ref` on an existing gateway, from an allowlisted token, `ft_on_transfer` SHALL NOT fail. Any other check that rejects a payment without a `ref`, including the invoice checks, SHALL instead open the payment and refund it in the same call.

#### Scenario: Policy rejection becomes refund
- **WHEN** a payment with a `ref` would fail a deposit-time check
- **THEN** `ft_on_transfer` returns zero unused tokens and the payment is Refunded

#### Scenario: Invoice mismatch becomes refund
- **WHEN** a payment with a `ref` names an invoice that is already Paid
- **THEN** `ft_on_transfer` returns zero unused tokens and the payment is Refunded

### Requirement: Settle or refund on the screening result
The system SHALL settle a Pending payment to the gateway payout account only when screening returns `true`, and SHALL refund it to its refund account on `false`, a malformed result, an error or a timeout. Both transfers SHALL use the payment's token. Each payment closes once and logs `CLOSED`; a failed transfer moves it to a retryable failed state instead of `Settled` or `Refunded`.

#### Scenario: Approved
- **WHEN** the enclave returns `true`
- **THEN** the payment becomes Settled and the amount is transferred to the payout account

#### Scenario: Enclave fails
- **WHEN** the OutLayer execution fails
- **THEN** the payment becomes Refunded, the amount goes to the refund account, and the execution deposit returns to the gateway's fuel

#### Scenario: Payout account cannot receive
- **WHEN** the enclave returns `true` but the payout account has no storage on the payment's token
- **THEN** the payment becomes `SettleFailed`

#### Scenario: Token removed while pending
- **WHEN** the payment's token is removed from the allowlist before screening ends
- **THEN** the payment still settles or refunds in that token

### Requirement: Payment lookup
The system SHALL expose a read-only view of a payment's gateway, payer, refund account, token, amount, invoice, `ref`, deposit address, open time, `max_risk` and status.

#### Scenario: Refunded payment
- **WHEN** `get_payment` is called for a refunded payment
- **THEN** it returns the payment with status `Refunded`

## ADDED Requirements

### Requirement: Operator token allowlist
The system SHALL accept payments and invoices only in tokens on an allowlist. Only the Gateflow contract account SHALL add or remove a token. A read-only view SHALL return the allowlist.

#### Scenario: Operator adds a token
- **WHEN** the contract account calls `add_token("nbtc.bridge.near")`
- **THEN** `get_tokens` includes `nbtc.bridge.near` and nBTC payments are accepted

#### Scenario: Other account rejected
- **WHEN** any other account calls `add_token` or `remove_token`
- **THEN** the call fails

### Requirement: Payments by gateway
The system SHALL expose a read-only view `get_payments(gateway, from_index, limit)` returning `[id, payment]` pairs of that gateway in open order, starting at position `from_index`, with at most `min(limit, 100)` entries. An unknown gateway or a position past the end SHALL return an empty list. Payments refunded at delivery SHALL be included.

#### Scenario: Page of payments
- **WHEN** gateway 0 has 2 payments and `get_payments(0, 0, 10)` is called
- **THEN** it returns both payments with their ids, oldest first

#### Scenario: Unknown gateway
- **WHEN** `get_payments(42, 0, 10)` is called and gateway 42 does not exist
- **THEN** it returns an empty list
