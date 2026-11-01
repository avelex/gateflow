# Spec Delta

## REMOVED Requirements

### Requirement: Policy validation
**Reason**: Its level and threshold rules apply to policy fields that are removed with KYC.
**Migration**: Replaced by "Risk cap validation". A policy is now `{"max_risk": <0..80>}`.

## ADDED Requirements

### Requirement: Risk cap validation
A gateway policy SHALL consist of `max_risk` only, and the system SHALL reject a policy whose `max_risk` exceeds 80, both at gateway creation and at policy update.

#### Scenario: Risk cap too high rejected
- **WHEN** a policy has `max_risk = 90`
- **THEN** the call fails with "risk cap too high"

#### Scenario: Risk cap accepted
- **WHEN** a merchant creates a gateway with policy `{"max_risk": 80}`
- **THEN** the gateway is created with that policy
