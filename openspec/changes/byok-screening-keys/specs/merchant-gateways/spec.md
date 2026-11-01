# Spec Delta

## MODIFIED Requirements

### Requirement: Gateway lookup
The system SHALL expose a read-only view returning a gateway's owner, payout account, policy, fuel, secrets profile, and its number of invoices and payments, or nothing for an unknown id.

#### Scenario: Unknown gateway
- **WHEN** `get_gateway` is called with an id that was never created
- **THEN** it returns null

#### Scenario: Counts for paging
- **WHEN** gateway 0 has 3 invoices and 2 payments
- **THEN** `get_gateway(0)` reports 3 invoices and 2 payments

## ADDED Requirements

### Requirement: Owner-only secrets profile
The system SHALL let only the gateway owner set or clear the gateway's OutLayer secrets profile name with `set_secrets(gateway, profile?)`. A profile name SHALL be 1 to 32 characters of lowercase letters, digits, `-` or `_`.

#### Scenario: Profile set
- **WHEN** the owner of gateway 0 calls `set_secrets(0, "gateflow")`
- **THEN** `get_gateway(0)` returns secrets profile `gateflow`

#### Scenario: Non-owner rejected
- **WHEN** another account calls `set_secrets(0, "gateflow")`
- **THEN** the call fails with "not the gateway owner"

#### Scenario: Invalid name
- **WHEN** the owner calls `set_secrets(0, "Gateflow Keys")`
- **THEN** the call fails with "invalid secrets profile"
