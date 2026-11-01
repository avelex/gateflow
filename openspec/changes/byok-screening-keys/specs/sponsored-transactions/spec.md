# Spec Delta

## MODIFIED Requirements

### Requirement: Sponsorship allowlist
The backend SHALL relay a delegate action only if its sender is the session merchant's account and every action is a function call with at most 100 Tgas that is either a call to the Gateflow contract's `create_gateway`, `create_invoice`, `set_policy` or `set_secrets` with zero deposit, or a call to the OutLayer contract's `store_secrets` or `delete_secrets` with at most 0.1 NEAR deposit and profile `gateflow`. It SHALL answer 403 for anything else and submit nothing.

#### Scenario: Transfer refused
- **WHEN** a delegate action contains a NEAR transfer
- **THEN** the backend answers 403 and submits nothing

#### Scenario: Other merchant's account
- **WHEN** Kaja's session posts a delegate action whose sender is another merchant's account
- **THEN** the backend answers 403

#### Scenario: Secret stored under another profile
- **WHEN** a `store_secrets` delegate action names profile `other`
- **THEN** the backend answers 403

## ADDED Requirements

### Requirement: BYOK storage deposit
Before a merchant stores a provider key, the backend SHALL transfer from the operator to the merchant's account enough NEAR for the OutLayer storage deposit (0.1 NEAR) when the account's balance is below it, at most once per merchant per UTC day.

#### Scenario: First key
- **WHEN** Kaja starts adding a provider key and her account holds 0.01 NEAR
- **THEN** the operator transfers 0.1 NEAR to her account before the console asks her to sign `store_secrets`

#### Scenario: Repeated request
- **WHEN** Kaja requests the deposit a second time on the same UTC day
- **THEN** the backend answers 429 and transfers nothing
