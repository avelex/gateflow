# Spec Delta

## ADDED Requirements

### Requirement: Screening uses the gateway's secrets
Every screening execution, direct or deferred, SHALL pass `secrets_ref` `{profile: <gateway secrets profile>, account_id: <gateway owner>}` when the gateway has a secrets profile, and the operator's `default` profile otherwise. The account in a gateway's secrets reference SHALL always be the gateway owner.

#### Scenario: BYOK gateway
- **WHEN** a payment is screened on a gateway owned by `kaja.gateflow.testnet` with secrets profile `gateflow`
- **THEN** the OutLayer request carries `secrets_ref {"profile":"gateflow","account_id":"kaja.gateflow.testnet"}`

#### Scenario: Profile changed while pending
- **WHEN** the owner clears the secrets profile after a `ref` payment opened but before `screen_intents`
- **THEN** the deferred screening uses the operator's `default` profile
