# Spec Delta

## Purpose

Lets a merchant screen their payments with their own compliance-provider key, sealed so that only the OutLayer enclave can read it and only screenings of that merchant's gateway can use it.

## ADDED Requirements

### Requirement: Key sealed in the browser
The console SHALL encrypt a provider key in the browser for the OutLayer keystore and store it with a merchant-signed `store_secrets` under the merchant's account, profile `gateflow`, bound to the Gateflow enclave project. The plaintext key SHALL NOT be sent to the Gateflow backend or written to its logs or database.

#### Scenario: Chainalysis key added
- **WHEN** Kaja pastes a Chainalysis key and confirms the passkey prompts
- **THEN** OutLayer holds an encrypted secret owned by Kaja's account under profile `gateflow`, and the backend's requests and database contain only the key's last 4 characters

### Requirement: Merchant key used only for their gateway
The enclave SHALL receive a merchant's secrets only through executions the Gateflow contract requests for a gateway owned by that merchant. An execution requested by any other caller SHALL output null before calling any provider.

#### Scenario: Direct call with a merchant profile
- **WHEN** an account runs the Gateflow enclave project directly with `secrets_ref` naming Kaja's profile
- **THEN** the enclave outputs null and makes no provider request

### Requirement: Chainalysis sanctions check
When `CHAINALYSIS_API_KEY` is present, the enclave SHALL query the Chainalysis Sanctions API for every screened address, meaning the direct payer or every origin-chain sender. An address with any identification SHALL score 100. The final score per address SHALL be the higher of this score and the built-in score.

#### Scenario: Sanctioned origin sender
- **WHEN** a Bitcoin sender is identified by Chainalysis but absent from the OFAC list
- **THEN** screening returns false and the payment is refunded

#### Scenario: Clean sender
- **WHEN** Chainalysis returns no identification and the built-in score is within `max_risk`
- **THEN** screening passes

### Requirement: Provider failure fails closed
If the Chainalysis lookup fails (network error, non-200 status, or unparsable body), the screening SHALL return false.

#### Scenario: Invalid key
- **WHEN** Chainalysis answers 401 for the merchant's key
- **THEN** screening returns false and the payment is refunded

### Requirement: No key, built-in screening
A gateway without a secrets profile, or whose profile has no provider key, SHALL be screened by the built-in GoPlus and OFAC checks only, exactly as before.

#### Scenario: Gateway without BYOK
- **WHEN** a payment arrives on a gateway with no secrets profile
- **THEN** the execution uses the operator's `default` profile and the built-in checks decide

### Requirement: Key removal
Removing a provider SHALL clear the gateway's secrets profile and delete the merchant's OutLayer secret, after which screenings use built-in checks only and the storage deposit returns to the merchant account.

#### Scenario: Key removed
- **WHEN** Kaja removes Chainalysis and confirms the passkey prompts
- **THEN** `get_gateway` shows no secrets profile and the next screening runs built-in checks only
