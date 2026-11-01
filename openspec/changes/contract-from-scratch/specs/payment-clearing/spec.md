# Spec Delta

## MODIFIED Requirements

### Requirement: Payments arrive by ft_transfer_call
The system SHALL accept a payment only as a NEP-141 `ft_transfer_call` whose `msg` is JSON `{"invoice": <id>, "refund_to"?: <account>, "ref"?: <string>}`, from an allowlisted token contract, for a non-zero amount. The invoice SHALL determine the payment's gateway. It SHALL keep the full amount and return no unused tokens. Unknown `msg` fields SHALL be ignored.

#### Scenario: Wrong token rejected
- **WHEN** a token that is not on the allowlist calls `ft_on_transfer`
- **THEN** the call fails with "token not accepted" and the token contract returns the funds to the sender

#### Scenario: Malformed msg rejected
- **WHEN** `msg` is not valid payment JSON
- **THEN** the call fails and the funds return to the sender

#### Scenario: Payment without invoice
- **WHEN** 5 USDC arrive with `msg = {"refund_to":"bob.near"}` and USDC is allowlisted
- **THEN** the call fails and the funds return to the sender, and no payment is recorded

#### Scenario: Unknown invoice
- **WHEN** a payment names an invoice id that was never created
- **THEN** the call fails with "unknown invoice" and the funds return to the sender, with or without a `ref`

### Requirement: Payment opened and screened
On accepting a payment without a `ref`, the system SHALL record it as Pending with payer, refund account (`refund_to` or the sender), token, amount, invoice, gateway, open time and the gateway's `max_risk`, emit `payment_opened`, and request one TEE screening of the NEAR sender account against `max_risk`.

#### Scenario: Screening requested
- **WHEN** a valid payment without a `ref` arrives
- **THEN** the payment is Pending and an OutLayer execution runs with `{"kind":"screen","payer":<sender>,"max_risk":<n>}`

### Requirement: Settle or refund on the screening result
The system SHALL settle a Pending payment to the gateway payout account only when screening returns `true`, and SHALL refund it to its refund account on `false`, a malformed result, an error or a timeout. Both transfers SHALL use the payment's token. Each payment closes once and emits `payment_closed`; a failed transfer moves it to a retryable failed state instead of `Settled` or `Refunded`.

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

### Requirement: Only the configured enclave answers
The enclave SHALL answer only executions whose caller is the configured Gateflow contract. Only the operator SHALL change the OutLayer contract and project that the Gateflow contract calls.

#### Scenario: Foreign caller
- **WHEN** an account other than the Gateflow contract triggers the enclave
- **THEN** the enclave outputs null

#### Scenario: Non-operator changes the enclave
- **WHEN** an account other than the operator calls `set_enclave`
- **THEN** the call fails with "not the operator"

### Requirement: Ref payments open without screening
On accepting a payment with a `ref`, the system SHALL record it as Pending with its `ref`, payer, refund account, token, amount, invoice, gateway, open time and the gateway's `max_risk`, emit `payment_opened`, and SHALL NOT request screening. A `ref` SHALL be unique across payments.

#### Scenario: 1Click delivery recorded
- **WHEN** `intents.near` delivers 10 USDC with `msg = {"invoice":7,"ref":"r1","refund_to":"bob.near"}` for Open invoice 7 of 10 USDC
- **THEN** the payment is Pending with `ref = "r1"`, no OutLayer execution runs, and no fuel is deducted

#### Scenario: Duplicate ref
- **WHEN** a second payment arrives with a `ref` already used by another payment
- **THEN** the payment opens and is refunded in the same call

### Requirement: Ref payments never fail at delivery
A payment with a `ref` SHALL be accepted only when its `sender_id` is `intents.near`; any other sender SHALL be rejected with "ref payments only from intents.near" and the funds return. For a `ref` payment from `intents.near`, in an allowlisted token, naming an existing invoice, `ft_on_transfer` SHALL NOT fail: any check that rejects a payment without a `ref`, including the invoice checks, SHALL instead open the payment and refund it in the same call.

#### Scenario: Policy rejection becomes refund
- **WHEN** a payment with a `ref` from `intents.near` would fail a deposit-time check
- **THEN** `ft_on_transfer` returns zero unused tokens and the payment is Refunded

#### Scenario: Invoice mismatch becomes refund
- **WHEN** a payment with a `ref` from `intents.near` names an invoice that is already Paid
- **THEN** `ft_on_transfer` returns zero unused tokens and the payment is Refunded

#### Scenario: Ref from another sender
- **WHEN** `alice.near` sends a payment with a `ref`
- **THEN** the call fails with "ref payments only from intents.near", the funds return to her, and no payment is recorded

### Requirement: Deferred screening call
The system SHALL let any account call `screen_intents(payment, deposit_address)` on a Pending payment with a `ref` that has not started screening. The call SHALL draw one execution deposit from gateway fuel, store the deposit address on the payment, and request one TEE screening with the deposit address, `ref`, invoice, amount and `max_risk`.

#### Scenario: Relay triggers screening
- **WHEN** the relay calls `screen_intents` for a Pending `ref` payment on a gateway with fuel
- **THEN** the deposit address is stored, fuel drops by one execution deposit, and an OutLayer execution runs

#### Scenario: Second call rejected
- **WHEN** `screen_intents` is called on a payment whose screening already started
- **THEN** the call fails and no fuel is drawn

#### Scenario: Payment without ref
- **WHEN** `screen_intents` is called on a payment without a `ref`
- **THEN** the call fails

#### Scenario: No fuel
- **WHEN** `screen_intents` is called on a gateway with less fuel than the execution deposit
- **THEN** the call fails with "gateway has no fuel for screening" and the payment stays Pending until `reclaim`

### Requirement: Deferred screening binds the 1Click deposit
The enclave SHALL approve a deferred screening only if the 1Click status for the deposit address is `SUCCESS`, the quote's recipient is the Gateflow contract, its `customRecipientMsg` names the same invoice and `ref`, and the quoted output amount equals the payment amount. Otherwise it SHALL return false.

#### Scenario: Deposit from another quote
- **WHEN** `screen_intents` is called with a deposit address whose quote carries a different `ref`
- **THEN** screening returns false and the payment is refunded

#### Scenario: Swap not finished
- **WHEN** the 1Click status for the deposit address is `PROCESSING`
- **THEN** screening returns false and the payment is refunded

#### Scenario: Quote for another invoice
- **WHEN** the deposit address's quote carries the same `ref` but a different invoice
- **THEN** screening returns false and the payment is refunded

### Requirement: Failed payout transfer is retryable
When the token transfer that settles or refunds a payment fails, the system SHALL mark the payment `SettleFailed` or `RefundFailed` and emit `transfer_failed`. Any account SHALL be able to call `retry(payment)` on such a payment to send the same amount to the same receiver again. A successful transfer SHALL leave the payment `Settled` or `Refunded`.

#### Scenario: Receiver without storage
- **WHEN** a refund in `zec.omft.near` goes to a `refund_to` account that has no storage on that token
- **THEN** the payment becomes `RefundFailed` and the tokens stay in the contract

#### Scenario: Retry after registration
- **WHEN** the receiver registers storage and anyone calls `retry` on the `RefundFailed` payment
- **THEN** the amount is transferred and the payment becomes `Refunded`

#### Scenario: Retry on a closed payment
- **WHEN** `retry` is called on a `Settled` payment
- **THEN** the call fails

### Requirement: Operator token allowlist
The system SHALL accept payments and invoices only in tokens on an allowlist. Only the operator SHALL add or remove a token. A read-only view SHALL return the allowlist.

#### Scenario: Operator adds a token
- **WHEN** the operator calls `add_token("nbtc.bridge.near")`
- **THEN** `get_tokens` includes `nbtc.bridge.near` and nBTC payments are accepted

#### Scenario: Other account rejected
- **WHEN** any other account calls `add_token` or `remove_token`
- **THEN** the call fails with "not the operator"

## ADDED Requirements

### Requirement: Operator role
The system SHALL store an operator account, set at initialization and returned by a read-only view. Only the operator SHALL call `set_operator` to hand the role to another account. The contract SHALL expose no method that deploys code, adds access keys or deletes the contract account.

#### Scenario: Operator rotated
- **WHEN** the operator calls `set_operator("ops2.near")`
- **THEN** `get_operator` returns `ops2.near` and only `ops2.near` can call operator methods

#### Scenario: Non-operator rotation rejected
- **WHEN** any other account calls `set_operator`
- **THEN** the call fails with "not the operator"

### Requirement: Funds leave only to payout or refund
The system SHALL transfer tokens out only to settle a payment to its gateway's `payout_to` or to refund it to its `refund_to`, at most once per successful transfer. No operator method SHALL transfer tokens or NEAR held for payments.

#### Scenario: Operator cannot withdraw
- **WHEN** the operator calls every operator method on a contract holding Pending payments
- **THEN** no token transfer leaves the contract

#### Scenario: Retry after success rejected
- **WHEN** `retry` is called on a payment whose transfer already succeeded
- **THEN** the call fails and no second transfer is sent

### Requirement: Contract events
The system SHALL log each state change as a NEP-297 event with standard `gateflow` and version `1.0.0`: `invoice_created {invoice, gateway}`, `payment_opened {payment, invoice, gateway, ref?}`, `payment_closed {payment, invoice, status}` and `transfer_failed {payment, receiver}`.

#### Scenario: Payment opened event
- **WHEN** a payment opens against invoice 7 of gateway 0
- **THEN** the receipt logs `EVENT_JSON:{"standard":"gateflow","version":"1.0.0","event":"payment_opened","data":[{"payment":<id>,"invoice":7,"gateway":0}]}`

#### Scenario: Refunded at delivery
- **WHEN** a `ref` payment opens and is refunded in the same call
- **THEN** the receipt logs `payment_opened` followed by `payment_closed` with status `Refunded`
