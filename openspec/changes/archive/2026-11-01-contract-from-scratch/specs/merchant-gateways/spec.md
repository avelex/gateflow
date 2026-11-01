# Spec Delta

## MODIFIED Requirements

### Requirement: Create a gateway
The system SHALL let any NEAR account create a gateway with a payout account and a policy, attaching at least one execution deposit. The caller becomes the gateway owner, the attached deposit becomes the gateway's screening fuel, and the system SHALL return a new sequential gateway id. A gateway SHALL NOT be tied to a token; it accepts every allowlisted token.

#### Scenario: Gateway created with fuel
- **WHEN** an account calls `create_gateway` with a valid policy and attaches 0.05 NEAR
- **THEN** a gateway with the next id exists, its owner is the caller, and its fuel is 0.05 NEAR

#### Scenario: One gateway, several tokens
- **WHEN** the owner of gateway 0 creates one invoice in USDC and one in nBTC
- **THEN** both invoices belong to gateway 0

#### Scenario: Gateway without fuel rejected
- **WHEN** an account calls `create_gateway` with less than one execution deposit attached
- **THEN** the call fails with "attach at least one execution deposit" and no gateway is created
