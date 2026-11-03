# Spec Delta

## ADDED Requirements

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
