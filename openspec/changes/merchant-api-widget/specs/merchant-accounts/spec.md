# Spec Delta

## MODIFIED Requirements

### Requirement: Session grants read access only
A session SHALL let the merchant read their own account, gateway, invoices, payments and preferences. A session alone SHALL NOT change anything on-chain; on-chain changes require a merchant-signed delegate action. The one exception SHALL be `create_invoice` sent through the merchant API, which the relay signs with the invoice signer key only after the merchant added that key with a passkey-signed delegate action.

#### Scenario: Another merchant's data
- **WHEN** a session for `kaja@example.com` requests console data
- **THEN** only data of Kaja's gateway is returned

#### Scenario: API invoice without signer key
- **WHEN** Kaja has not enabled the API
- **THEN** the relay creates no invoice for Kaja without a delegate action Kaja signed
