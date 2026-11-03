# sponsored-transactions Specification

## Purpose

Lets the operator pay NEAR gas and screening fuel for merchants while only the merchant's own signature can authorize changes to their gateway, and keeps the operator's sponsorship from being spent on anything else.

## Requirements

### Requirement: Relay merchant-signed delegate actions
`POST /console/relay` SHALL accept a NEP-366 signed delegate action from a signed-in merchant, wrap it in a transaction signed and paid by the operator, submit it, and return the transaction hash and the decoded return value of the Gateflow call.

#### Scenario: Invoice created through the relayer
- **WHEN** Kaja's console posts a signed delegate action calling `create_invoice`
- **THEN** the backend submits it and returns the tx hash and the new invoice id

### Requirement: Sponsorship allowlist
The backend SHALL relay a delegate action only if its sender is the session merchant's account, its receiver is the Gateflow contract, and every action is a function call to `create_gateway`, `create_invoice` or `set_policy` with zero deposit and at most 100 Tgas. A `create_gateway` call SHALL be relayed only when its `payout_to` equals the sender. It SHALL answer 403 for anything else and submit nothing.

#### Scenario: Transfer refused
- **WHEN** a delegate action contains a NEAR transfer
- **THEN** the backend answers 403 and submits nothing

#### Scenario: Other merchant's account
- **WHEN** Kaja's session posts a delegate action whose sender is another merchant's account
- **THEN** the backend answers 403

#### Scenario: Gateway paying out elsewhere
- **WHEN** Kaja's session posts a delegate action calling `create_gateway` with `payout_to` `kaja-shop.near`, which is not her account
- **THEN** the backend answers 403 and submits nothing

#### Scenario: Payout change not sponsored
- **WHEN** Kaja's session posts a delegate action calling `set_payout`
- **THEN** the backend answers 403 and submits nothing

### Requirement: Failed relayed call is reported
When the relayed Gateflow call fails on-chain, the backend SHALL answer 422 with the contract's panic message so the console can show it.

#### Scenario: Expiry out of range
- **WHEN** a relayed `create_invoice` panics with "invalid expiry"
- **THEN** the backend answers 422 `{"error":"invalid expiry"}`

### Requirement: Fuel kept topped up
Whenever the backend reads a merchant's gateway and its fuel is below twice the execution deposit, it SHALL call `fund` from the operator account to bring the fuel to the configured target.

#### Scenario: Low fuel
- **WHEN** Kaja opens the console and her gateway's fuel is below two execution deposits
- **THEN** the operator funds the gateway back to the target before the page data returns

### Requirement: Permissionless retries by the operator
The backend SHALL let a signed-in merchant request `retry` of their own `SettleFailed` or `RefundFailed` payment, and SHALL submit it from the operator account without a merchant signature.

#### Scenario: Retry a failed refund
- **WHEN** Kaja retries a `RefundFailed` payment of her gateway
- **THEN** the operator submits `retry` and the payment becomes `Refunded` once the transfer succeeds
