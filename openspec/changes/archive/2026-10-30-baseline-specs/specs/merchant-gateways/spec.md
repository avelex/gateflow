# Spec Delta

## Purpose

Lets a merchant register a payment gateway on the Gateflow contract that fixes where settled funds go, which token is accepted, which compliance policy applies, and how screening is paid for.

## ADDED Requirements

### Requirement: Create a gateway
The system SHALL let any NEAR account create a gateway with a payout account, one accepted NEP-141 token and a policy. The caller becomes the gateway owner, the attached deposit becomes the gateway's screening fuel, and the system SHALL return a new sequential gateway id.

#### Scenario: Gateway created with fuel
- **WHEN** an account calls `create_gateway` with a valid policy and attaches 0.05 NEAR
- **THEN** a gateway with the next id exists, its owner is the caller, and its fuel is 0.05 NEAR

### Requirement: Policy validation
The system SHALL reject a policy whose levels exceed the maximum verification level (2), whose `level_above` is non-zero while `level_below` is zero, whose threshold exceeds 10,000 units of a 6-decimal token, or whose `max_risk` exceeds 80.

#### Scenario: Threshold without identity rejected
- **WHEN** a policy has `level_below = 0` and `level_above = 2`
- **THEN** the call fails with "threshold without identity"

#### Scenario: Risk cap too high rejected
- **WHEN** a policy has `max_risk = 90`
- **THEN** the call fails with "risk cap too high"

### Requirement: Owner-only policy updates
The system SHALL let only the gateway owner replace the gateway's policy, applying the same validation as at creation.

#### Scenario: Non-owner cannot change policy
- **WHEN** an account other than the owner calls `set_policy`
- **THEN** the call fails with "not the gateway owner"

### Requirement: Anyone can add fuel
The system SHALL let any account add NEAR to a gateway's fuel by attaching a deposit to `fund`.

#### Scenario: Fuel top-up
- **WHEN** an account calls `fund` on gateway 0 with 0.1 NEAR attached
- **THEN** gateway 0's fuel increases by 0.1 NEAR

### Requirement: Payout is a NEAR account
The system SHALL settle approved payments only to the gateway's payout NEAR account, in the gateway's token.

#### Scenario: Settlement destination
- **WHEN** a payment on a gateway is approved
- **THEN** the gateway token is transferred to the gateway's `payout_to` account on NEAR

### Requirement: Gateway lookup
The system SHALL expose a read-only view returning a gateway's owner, payout account, token, policy and fuel, or nothing for an unknown id.

#### Scenario: Unknown gateway
- **WHEN** `get_gateway` is called with an id that was never created
- **THEN** it returns null
