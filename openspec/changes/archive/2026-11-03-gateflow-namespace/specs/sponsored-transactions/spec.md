# Spec Delta

## MODIFIED Requirements

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
