# Spec Delta

## ADDED Requirements

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

## REMOVED Requirements

### Requirement: Create a gateway
**Reason**: Merchants sign `create_gateway` as a sponsored delegate action, which carries no deposit, so requiring one execution deposit made onboarding impossible.
**Migration**: Replaced by "Create a gateway with optional fuel". Fund a new gateway with `fund` before its first invoice or payment.
