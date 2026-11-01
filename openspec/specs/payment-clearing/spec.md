# payment-clearing Specification

## Purpose

Holds each incoming payment in the Gateflow contract until a TEE screens the payer, then lets the contract do exactly one of two things: settle to the merchant or refund the payer.

## Requirements

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

### Requirement: Screening needs fuel
The system SHALL reject a payment without a `ref` when the gateway's fuel is below the execution deposit, and otherwise deduct one execution deposit from the fuel when it opens the payment. For a payment with a `ref`, the fuel check and deduction SHALL happen at deferred screening instead.

#### Scenario: Empty gateway
- **WHEN** a payment without a `ref` arrives at a gateway with less fuel than the execution deposit
- **THEN** the call fails with "gateway has no fuel for screening"

#### Scenario: Empty gateway, ref payment
- **WHEN** a payment with a `ref` arrives at a gateway with no fuel
- **THEN** the payment opens as Pending and no fuel is deducted

### Requirement: Payment opened and screened
On accepting a payment without a `ref`, the system SHALL record it as Pending with payer, refund account (`refund_to` or the sender), token, amount, invoice, gateway, open time and the gateway's `max_risk`, emit `payment_opened`, and request one TEE screening of the NEAR sender account against `max_risk`.

#### Scenario: Screening requested
- **WHEN** a valid payment without a `ref` arrives
- **THEN** the payment is Pending and an OutLayer execution runs with `{"kind":"screen","payer":<sender>,"max_risk":<n>}`

### Requirement: Screened sender is the NEAR sender
For payments without a `ref`, the system SHALL screen the `sender_id` of `ft_on_transfer`. The screener SHALL pass only EVM addresses (`0x` + 40 hex) whose highest weighted GoPlus flag on chain id 1 is at most `max_risk`, and SHALL fail closed for any other account.

#### Scenario: Named NEAR account fails closed
- **WHEN** `alice.testnet` pays
- **THEN** screening returns false and the payment is refunded

#### Scenario: 1Click delivery screens the Intents sender
- **WHEN** a payment without a `ref` arrives through a 1Click `ft_transfer_call`
- **THEN** the screened account is the NEAR account that delivered the tokens, not the origin-chain payer, and the payment is refunded

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

### Requirement: Reclaim after the clearing window
The system SHALL let anyone refund a payment that is still Pending 15 minutes after it opened.

#### Scenario: Window still open
- **WHEN** `reclaim` is called 5 minutes after a payment opened
- **THEN** the call fails with "clearing window is still open"

#### Scenario: Stuck payment
- **WHEN** `reclaim` is called on a payment Pending for over 15 minutes
- **THEN** the payment becomes Refunded and the amount goes to its refund account

### Requirement: Only the configured enclave answers
The enclave SHALL answer only executions whose caller is the configured Gateflow contract. Only the operator SHALL change the OutLayer contract and project that the Gateflow contract calls.

#### Scenario: Foreign caller
- **WHEN** an account other than the Gateflow contract triggers the enclave
- **THEN** the enclave outputs null

#### Scenario: Non-operator changes the enclave
- **WHEN** an account other than the operator calls `set_enclave`
- **THEN** the call fails with "not the operator"

### Requirement: Payment lookup
The system SHALL expose a read-only view of a payment's gateway, payer, refund account, token, amount, invoice, `ref`, deposit address, open time, `max_risk` and status.

#### Scenario: Refunded payment
- **WHEN** `get_payment` is called for a refunded payment
- **THEN** it returns the payment with status `Refunded`

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
The system SHALL let only the relay account call `screen_intents(payment, deposit_address)` on a Pending payment with a `ref` that has not started screening. The call SHALL draw one execution deposit from gateway fuel, store the deposit address on the payment, and request one TEE screening with the deposit address, `ref`, invoice, amount and `max_risk`.

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

#### Scenario: Other caller rejected
- **WHEN** an account other than the relay calls `screen_intents` with a wrong deposit address before the relay does
- **THEN** the call fails with "not the relay", no fuel is drawn, and the relay can still screen the payment

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

### Requirement: Deferred screening checks the origin senders
The enclave SHALL determine the origin chain from 1Click's record of the quote, resolve the senders of every origin deposit transaction 1Click lists, and approve only if every sender passes that chain's screener against `max_risk`. Supported origins are the configured EVM chains, Bitcoin and Zcash. Any other origin, a missing transaction, an unresolvable sender or a failed lookup SHALL fail closed.

#### Scenario: Clean EVM payer
- **WHEN** the origin deposit transaction on Base is from an address with no GoPlus flags
- **THEN** screening returns true and the payment settles to the merchant

#### Scenario: Flagged EVM payer
- **WHEN** the origin deposit transaction is from a sanctioned address
- **THEN** screening returns false and the payment is refunded

#### Scenario: Unsupported origin
- **WHEN** the quote's origin chain is not EVM, Bitcoin or Zcash
- **THEN** screening returns false and the payment is refunded

#### Scenario: Several origin deposits
- **WHEN** 1Click lists two origin transactions and one comes from a flagged address
- **THEN** screening returns false and the payment is refunded

### Requirement: Bitcoin senders are every input address
For a Bitcoin origin, the senders SHALL be the addresses of all inputs of the deposit transaction, and each SHALL be checked against the OFAC sanctioned Bitcoin address list. A listed address SHALL count as risk 100 and any other as 0.

#### Scenario: Clean Bitcoin payer
- **WHEN** no input address of the BTC deposit is on the OFAC list
- **THEN** screening returns true and the nBTC payment settles

#### Scenario: Sanctioned input
- **WHEN** one input address of the BTC deposit is on the OFAC list
- **THEN** screening returns false and the payment is refunded

### Requirement: Zcash senders are transparent input addresses
For a Zcash origin, the senders SHALL be the transparent input addresses of the deposit transaction, each checked against the OFAC sanctioned Zcash address list. A deposit with no transparent inputs SHALL fail closed.

#### Scenario: Transparent sender
- **WHEN** the ZEC deposit spends from `t1` addresses that are not on the OFAC list
- **THEN** screening returns true and the ZEC payment settles

#### Scenario: Shielded sender
- **WHEN** the ZEC deposit comes from the shielded pool with no transparent inputs
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

### Requirement: Payment lookup by ref
The system SHALL expose a read-only view returning the payment id and payment for a `ref`, or nothing for an unknown `ref`.

#### Scenario: Known ref
- **WHEN** `get_payment_by_ref` is called with `"r1"`
- **THEN** it returns the id and Pending payment opened with that `ref`

### Requirement: Operator token allowlist
The system SHALL accept payments and invoices only in tokens on an allowlist. Only the operator SHALL add or remove a token. A read-only view SHALL return the allowlist.

#### Scenario: Operator adds a token
- **WHEN** the operator calls `add_token("nbtc.bridge.near")`
- **THEN** `get_tokens` includes `nbtc.bridge.near` and nBTC payments are accepted

#### Scenario: Other account rejected
- **WHEN** any other account calls `add_token` or `remove_token`
- **THEN** the call fails with "not the operator"

### Requirement: Payments by gateway
The system SHALL expose a read-only view `get_payments(gateway, from_index, limit)` returning `[id, payment]` pairs of that gateway in open order, starting at position `from_index`, with at most `min(limit, 100)` entries. An unknown gateway or a position past the end SHALL return an empty list. Payments refunded at delivery SHALL be included.

#### Scenario: Page of payments
- **WHEN** gateway 0 has 2 payments and `get_payments(0, 0, 10)` is called
- **THEN** it returns both payments with their ids, oldest first

#### Scenario: Unknown gateway
- **WHEN** `get_payments(42, 0, 10)` is called and gateway 42 does not exist
- **THEN** it returns an empty list

### Requirement: Operator role
The system SHALL store an operator account, set at initialization and returned by a read-only view. Only the operator SHALL call `set_operator` to hand the role to another account. The contract SHALL expose no method that deploys code, adds access keys or deletes the contract account.

#### Scenario: Operator rotated
- **WHEN** the operator calls `set_operator("ops2.near")`
- **THEN** `get_operator` returns `ops2.near` and only `ops2.near` can call operator methods

#### Scenario: Non-operator rotation rejected
- **WHEN** any other account calls `set_operator`
- **THEN** the call fails with "not the operator"

### Requirement: Relay account
The system SHALL store a relay account, set at initialization and returned by a read-only view. Only the operator SHALL change it with `set_relay`. The relay can only start a deferred screening; it SHALL NOT be able to approve, settle or refund a payment.

#### Scenario: Operator changes the relay
- **WHEN** the operator calls `set_relay("relay2.near")`
- **THEN** `get_relay` returns `relay2.near` and only `relay2.near` can call `screen_intents`

#### Scenario: Non-operator rejected
- **WHEN** any other account calls `set_relay`
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
