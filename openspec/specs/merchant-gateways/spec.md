# merchant-gateways Specification

## Purpose

Lets a merchant register a payment gateway on the Gateflow contract that fixes where settled funds go, which token is accepted, which compliance policy applies, and how screening is paid for.

## Requirements

### Requirement: Create a gateway with optional fuel
The system SHALL let any NEAR account create a gateway with a payout account and a policy, with or without an attached deposit. The caller becomes the gateway owner, any attached deposit becomes the gateway's screening fuel, and the system SHALL return a new sequential gateway id. A gateway SHALL NOT be tied to a token; it accepts every allowlisted token.

#### Scenario: Gateway created with fuel
- **WHEN** an account calls `create_gateway` with a valid policy and attaches 0.05 NEAR
- **THEN** a gateway with the next id exists, its owner is the caller, and its fuel is 0.05 NEAR

#### Scenario: One gateway, several tokens
- **WHEN** the owner of gateway 0 creates one invoice in USDC and one in nBTC
- **THEN** both invoices belong to gateway 0

#### Scenario: Gateway created without a deposit
- **WHEN** a merchant account calls `create_gateway` with a valid policy and no deposit, as a relayed delegate action
- **THEN** a gateway with the next id exists, its owner is the merchant account, and its fuel is 0

### Requirement: Owner-only policy updates
The system SHALL let only the gateway owner replace the gateway's policy, applying the same validation as at creation.

#### Scenario: Non-owner cannot change policy
- **WHEN** an account other than the owner calls `set_policy`
- **THEN** the call fails with "not the gateway owner"

### Requirement: Owner-only payout updates
The system SHALL let only the gateway owner replace the gateway's payout account with `set_payout(gateway, payout_to)`. Later settles of that gateway's payments, including retries of `SettleFailed` payments, SHALL go to the new account.

#### Scenario: Owner changes payout
- **WHEN** the owner of gateway 0 calls `set_payout` with `kaja-shop.near`
- **THEN** `get_gateway(0)` reports `payout_to` `kaja-shop.near`, and the next approved payment of gateway 0 settles there

#### Scenario: Non-owner cannot change payout
- **WHEN** an account other than the owner calls `set_payout` on gateway 0
- **THEN** the call fails with "not the gateway owner" and `payout_to` is unchanged

#### Scenario: Unknown gateway
- **WHEN** `set_payout` is called with a gateway id that was never created
- **THEN** the call fails with "unknown gateway"

### Requirement: Anyone can add fuel
The system SHALL let any account add NEAR to a gateway's fuel by attaching a deposit to `fund`.

#### Scenario: Fuel top-up
- **WHEN** an account calls `fund` on gateway 0 with 0.1 NEAR attached
- **THEN** gateway 0's fuel increases by 0.1 NEAR

### Requirement: Payout is a NEAR account
The system SHALL settle approved payments only to the gateway's payout NEAR account, in the token the payment arrived in.

#### Scenario: Settlement destination
- **WHEN** a payment of 0.01 nBTC on a gateway is approved
- **THEN** 0.01 nBTC is transferred to the gateway's `payout_to` account on NEAR

### Requirement: Gateway lookup
The system SHALL expose a read-only view returning a gateway's owner, payout account, policy, fuel, and its number of invoices and payments, or nothing for an unknown id.

#### Scenario: Unknown gateway
- **WHEN** `get_gateway` is called with an id that was never created
- **THEN** it returns null

#### Scenario: Counts for paging
- **WHEN** gateway 0 has 3 invoices and 2 payments
- **THEN** `get_gateway(0)` reports 3 invoices and 2 payments

### Requirement: Risk cap validation
A gateway policy SHALL consist of `max_risk` only, and the system SHALL reject a policy whose `max_risk` exceeds 80, both at gateway creation and at policy update.

#### Scenario: Risk cap too high rejected
- **WHEN** a policy has `max_risk = 90`
- **THEN** the call fails with "risk cap too high"

#### Scenario: Risk cap accepted
- **WHEN** a merchant creates a gateway with policy `{"max_risk": 80}`
- **THEN** the gateway is created with that policy
