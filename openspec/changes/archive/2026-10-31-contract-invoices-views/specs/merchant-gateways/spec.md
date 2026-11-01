# Spec Delta

## MODIFIED Requirements

### Requirement: Create a gateway
The system SHALL let any NEAR account create a gateway with a payout account and a policy. The caller becomes the gateway owner, the attached deposit becomes the gateway's screening fuel, and the system SHALL return a new sequential gateway id. A gateway SHALL NOT be tied to a token; it accepts every allowlisted token.

#### Scenario: Gateway created with fuel
- **WHEN** an account calls `create_gateway` with a valid policy and attaches 0.05 NEAR
- **THEN** a gateway with the next id exists, its owner is the caller, and its fuel is 0.05 NEAR

#### Scenario: One gateway, several tokens
- **WHEN** the owner of gateway 0 creates one invoice in USDC and one in nBTC
- **THEN** both invoices belong to gateway 0

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
