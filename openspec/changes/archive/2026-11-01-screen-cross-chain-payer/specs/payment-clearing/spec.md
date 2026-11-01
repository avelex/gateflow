# Spec Delta

## MODIFIED Requirements

### Requirement: Payments arrive by ft_transfer_call
The system SHALL accept a payment only as a NEP-141 `ft_transfer_call` whose `msg` is JSON `{"gateway": <id>, "refund_to"?: <account>, "ref"?: <string>}`, from the gateway's token contract, for a non-zero amount. It SHALL keep the full amount and return no unused tokens.

#### Scenario: Wrong token rejected
- **WHEN** a token other than the gateway's accepted token calls `ft_on_transfer`
- **THEN** the call fails with "token not accepted by this gateway" and the token contract returns the funds to the sender

#### Scenario: Malformed msg rejected
- **WHEN** `msg` is not valid gateway JSON
- **THEN** the call fails and the funds return to the sender

### Requirement: Screening needs fuel
The system SHALL reject a payment without a `ref` when the gateway's fuel is below the execution deposit, and otherwise deduct one execution deposit from the fuel when it opens the payment. For a payment with a `ref`, the fuel check and deduction SHALL happen at deferred screening instead.

#### Scenario: Empty gateway
- **WHEN** a payment without a `ref` arrives at a gateway with less fuel than the execution deposit
- **THEN** the call fails with "gateway has no fuel for screening"

#### Scenario: Empty gateway, ref payment
- **WHEN** a payment with a `ref` arrives at a gateway with no fuel
- **THEN** the payment opens as Pending and no fuel is deducted

### Requirement: Payment opened and screened
On accepting a payment without a `ref`, the system SHALL record it as Pending with payer, refund account (`refund_to` or the sender), amount, open time and the gateway's `max_risk`, log `OPENED`, and request one TEE screening of the NEAR sender account against `max_risk`.

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
The system SHALL settle a Pending payment to the gateway payout account only when screening returns `true`, and SHALL refund it to its refund account on `false`, a malformed result, an error or a timeout. Each payment closes once and logs `CLOSED`; a failed transfer moves it to a retryable failed state instead of `Settled` or `Refunded`.

#### Scenario: Approved
- **WHEN** the enclave returns `true`
- **THEN** the payment becomes Settled and the amount is transferred to the payout account

#### Scenario: Enclave fails
- **WHEN** the OutLayer execution fails
- **THEN** the payment becomes Refunded, the amount goes to the refund account, and the execution deposit returns to the gateway's fuel

#### Scenario: Payout account cannot receive
- **WHEN** the enclave returns `true` but the payout account has no storage on the gateway token
- **THEN** the payment becomes `SettleFailed`

## ADDED Requirements

### Requirement: Ref payments open without screening
On accepting a payment with a `ref`, the system SHALL record it as Pending with its `ref`, payer, refund account, amount, open time and the gateway's `max_risk`, log `OPENED`, and SHALL NOT request screening. A `ref` SHALL be unique across payments.

#### Scenario: 1Click delivery recorded
- **WHEN** 1Click delivers 10 USDC with `msg = {"gateway":0,"ref":"r1","refund_to":"bob.near"}`
- **THEN** the payment is Pending with `ref = "r1"`, no OutLayer execution runs, and no fuel is deducted

#### Scenario: Duplicate ref
- **WHEN** a second payment arrives with a `ref` already used by another payment
- **THEN** the payment opens and is refunded in the same call

### Requirement: Ref payments never fail at delivery
For a payment with a `ref` on an existing gateway, from the gateway's token, `ft_on_transfer` SHALL NOT fail. Any other check that rejects a payment without a `ref` SHALL instead open the payment and refund it in the same call.

#### Scenario: Policy rejection becomes refund
- **WHEN** a payment with a `ref` would fail a deposit-time check
- **THEN** `ft_on_transfer` returns zero unused tokens and the payment is Refunded

### Requirement: Deferred screening call
The system SHALL let any account call `screen_intents(payment, deposit_address)` on a Pending payment with a `ref` that has not started screening. The call SHALL draw one execution deposit from gateway fuel, store the deposit address on the payment, and request one TEE screening with the deposit address, `ref`, gateway, amount and `max_risk`.

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
The enclave SHALL approve a deferred screening only if the 1Click status for the deposit address is `SUCCESS`, the quote's recipient is the Gateflow contract, its `customRecipientMsg` names the same gateway and `ref`, and the quoted output amount equals the payment amount. Otherwise it SHALL return false.

#### Scenario: Deposit from another quote
- **WHEN** `screen_intents` is called with a deposit address whose quote carries a different `ref`
- **THEN** screening returns false and the payment is refunded

#### Scenario: Swap not finished
- **WHEN** the 1Click status for the deposit address is `PROCESSING`
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
When the token transfer that settles or refunds a payment fails, the system SHALL mark the payment `SettleFailed` or `RefundFailed` and log it. Any account SHALL be able to call `retry(payment)` on such a payment to send the same amount to the same receiver again. A successful transfer SHALL leave the payment `Settled` or `Refunded`.

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
