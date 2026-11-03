# Spec Delta

## MODIFIED Requirements

### Requirement: Failed payout transfer is retryable
When the token transfer that settles or refunds a payment fails, the system SHALL mark the payment `SettleFailed` or `RefundFailed` and emit `transfer_failed`. Any account SHALL be able to call `retry(payment)` on such a payment to send the same amount again: a settle to the gateway's current `payout_to`, a refund to the payment's `refund_to`. A successful transfer SHALL leave the payment `Settled` or `Refunded`.

#### Scenario: Receiver without storage
- **WHEN** a refund in `zec.omft.near` goes to a `refund_to` account that has no storage on that token
- **THEN** the payment becomes `RefundFailed` and the tokens stay in the contract

#### Scenario: Retry after registration
- **WHEN** the receiver registers storage and anyone calls `retry` on the `RefundFailed` payment
- **THEN** the amount is transferred and the payment becomes `Refunded`

#### Scenario: Retry after the payout changed
- **WHEN** a payment of gateway 0 is `SettleFailed`, the owner calls `set_payout` with `kaja-shop.near`, and anyone calls `retry`
- **THEN** the amount is transferred to `kaja-shop.near` and the payment becomes `Settled`

#### Scenario: Retry on a closed payment
- **WHEN** `retry` is called on a `Settled` payment
- **THEN** the call fails
