# Spec Delta

## Purpose

Holds each incoming payment in the Gateflow contract until a TEE screens the payer, then lets the contract do exactly one of two things: settle to the merchant or refund the payer.

## ADDED Requirements

### Requirement: Payments arrive by ft_transfer_call
The system SHALL accept a payment only as a NEP-141 `ft_transfer_call` whose `msg` is JSON `{"gateway": <id>, "refund_to"?: <account>}`, from the gateway's token contract, for a non-zero amount. It SHALL keep the full amount and return no unused tokens.

#### Scenario: Wrong token rejected
- **WHEN** a token other than the gateway's accepted token calls `ft_on_transfer`
- **THEN** the call fails with "token not accepted by this gateway" and the token contract returns the funds to the sender

#### Scenario: Malformed msg rejected
- **WHEN** `msg` is not valid gateway JSON
- **THEN** the call fails and the funds return to the sender

### Requirement: Screening needs fuel
The system SHALL reject a payment when the gateway's fuel is below the execution deposit, and otherwise deduct one execution deposit from the fuel when it opens the payment.

#### Scenario: Empty gateway
- **WHEN** a payment arrives at a gateway with less fuel than the execution deposit
- **THEN** the call fails with "gateway has no fuel for screening"

### Requirement: Identity policy enforced at deposit
The system SHALL require the payer to hold a valid attestation at `level_above` when the amount is at or above the policy threshold, at `level_below` otherwise, and no attestation when the required level is 0.

#### Scenario: Unverified payer above threshold
- **WHEN** a payer without an attestation pays an amount at or above the threshold of a gateway with `level_above = 2`
- **THEN** the call fails with "payer is not verified for this amount"

### Requirement: 24-hour spend limit per person
For payments that require identity, the system SHALL sum amounts per gateway and nullifier over a rolling 24-hour window, and SHALL reject a payment that brings the sum to the threshold or above unless the payer holds a `level_above` attestation. Refunds SHALL NOT reduce the sum.

#### Scenario: Split payments still hit the limit
- **WHEN** a level-1 payer makes two payments in 24 hours that together reach the threshold
- **THEN** the second payment fails with "24h total per person needs a higher verification level"

### Requirement: Payment opened and screened
On accepting a payment, the system SHALL record it as Pending with payer, refund account (`refund_to` or the sender), amount, open time and the gateway's `max_risk`, log `OPENED`, and request one TEE screening of the NEAR sender account against `max_risk`.

#### Scenario: Screening requested
- **WHEN** a valid payment arrives
- **THEN** the payment is Pending and an OutLayer execution runs with `{"kind":"screen","payer":<sender>,"max_risk":<n>}`

### Requirement: Screened sender is the NEAR sender
The system SHALL screen the `sender_id` of `ft_on_transfer`. The screener SHALL pass only EVM addresses (`0x` + 40 hex) whose highest weighted GoPlus flag on chain id 1 is at most `max_risk`, and SHALL fail closed for any other account.

#### Scenario: Named NEAR account fails closed
- **WHEN** `alice.testnet` pays
- **THEN** screening returns false and the payment is refunded

#### Scenario: 1Click delivery screens the Intents sender
- **WHEN** a payment arrives through a 1Click `ft_transfer_call`
- **THEN** the screened account is the NEAR account that delivered the tokens, not the origin-chain payer, and the payment is refunded

### Requirement: Settle or refund on the screening result
The system SHALL settle a Pending payment to the gateway payout account only when screening returns `true`, and SHALL refund it to its refund account on `false`, a malformed result, an error or a timeout. Each payment closes once and logs `CLOSED`.

#### Scenario: Approved
- **WHEN** the enclave returns `true`
- **THEN** the payment becomes Settled and the amount is transferred to the payout account

#### Scenario: Enclave fails
- **WHEN** the OutLayer execution fails
- **THEN** the payment becomes Refunded, the amount goes to the refund account, and the execution deposit returns to the gateway's fuel

### Requirement: Reclaim after the clearing window
The system SHALL let anyone refund a payment that is still Pending 15 minutes after it opened.

#### Scenario: Window still open
- **WHEN** `reclaim` is called 5 minutes after a payment opened
- **THEN** the call fails with "clearing window is still open"

#### Scenario: Stuck payment
- **WHEN** `reclaim` is called on a payment Pending for over 15 minutes
- **THEN** the payment becomes Refunded and the amount goes to its refund account

### Requirement: Only the configured enclave answers
The enclave SHALL answer only executions whose caller is the configured Gateflow contract. The contract SHALL let only itself change the OutLayer project it calls.

#### Scenario: Foreign caller
- **WHEN** an account other than the Gateflow contract triggers the enclave
- **THEN** the enclave outputs null

### Requirement: Payment lookup
The system SHALL expose a read-only view of a payment's gateway, payer, refund account, amount, open time, `max_risk` and status.

#### Scenario: Refunded payment
- **WHEN** `get_payment` is called for a refunded payment
- **THEN** it returns the payment with status `Refunded`
