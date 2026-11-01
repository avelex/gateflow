# Spec Delta

## ADDED Requirements

### Requirement: GoPlus risk score
The GoPlus score of an EVM address SHALL be the highest weight among the flags GoPlus's address security check reports as set for that address on chain id 1, or 0 when none is set. Chain id 1 SHALL be used for every EVM address, whatever its origin chain. A response that is not a successful GoPlus result SHALL give no score, so the screening fails closed. The weights are given by the scenarios below.

#### Scenario: Severe flag
- **WHEN** GoPlus sets any of `sanctioned`, `stealing_attack`, `cybercrime`, `money_laundering`, `financial_crime`, `darkweb_transactions`, `blackmail_activities` or `phishing_activities`
- **THEN** the score is 100

#### Scenario: High flag
- **WHEN** the highest flag GoPlus sets is one of `mixer`, `honeypot_related_address`, `fake_kyc`, `malicious_mining_activities` or `fake_token`, or `number_of_malicious_contracts_created` is above 0
- **THEN** the score is 70

#### Scenario: Low flag
- **WHEN** the only flags GoPlus sets are among `blacklist_doubt`, `gas_abuse`, `reinit` and `fake_standard_interface`
- **THEN** the score is 30, and a payer passes the default `max_risk` of 50

#### Scenario: Clean address
- **WHEN** GoPlus sets no flag for the address
- **THEN** the score is 0

#### Scenario: GoPlus error
- **WHEN** GoPlus answers with a non-success code or without a result for the address
- **THEN** screening returns false and the payment is refunded

### Requirement: Enclave reads no secrets
The enclave SHALL read no secrets. The accepted caller and the EVM RPC endpoint of each supported EVM origin chain (`base`, `eth`, `arb`) SHALL be fixed when the enclave is built, with one build per network. The enclave SHALL query 1Click without an API key.

#### Scenario: No secrets stored
- **WHEN** the Gateflow contract requests a screening and the secrets profile it references holds no values
- **THEN** the screening runs and returns its normal verdict

#### Scenario: Secret cannot move the caller check
- **WHEN** the referenced secrets profile defines `GATEFLOW_CONTRACT` as another account
- **THEN** the enclave still accepts only the contract it was built for

### Requirement: Every Gateflow execution ends in a verdict
For every execution whose caller is the Gateflow contract, the enclave SHALL output exactly `true` or `false` and SHALL NOT fail the execution. A failed or timed-out lookup, an unexpected response from any external service, or an unreadable request SHALL give `false`.

#### Scenario: Chain API down
- **WHEN** the Blockstream API fails while screening a BTC-origin payment
- **THEN** the enclave outputs `false`, the payment is refunded, and the gateway's execution deposit is not credited back

#### Scenario: Unreadable request
- **WHEN** the request JSON has an unknown `kind`
- **THEN** the enclave outputs `false`
