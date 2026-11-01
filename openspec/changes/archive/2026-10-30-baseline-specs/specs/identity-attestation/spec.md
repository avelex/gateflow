# Spec Delta

## Purpose

Lets a payer prove KYC status to one gateway while the identity document stays inside the TEE and the chain stores only a per-gateway nullifier, a level and an expiry.

## ADDED Requirements

### Requirement: Verify through the TEE
The system SHALL let a NEAR account call `verify(gateway, level)` with a deposit that covers one enclave execution, for a level between 1 and 2 on an existing gateway, and SHALL ask the enclave to verify that account at that level.

#### Scenario: Unknown level
- **WHEN** a wallet calls `verify` with level 3
- **THEN** the call fails with "unknown level"

#### Scenario: Deposit too small
- **WHEN** the attached deposit is below the execution deposit
- **THEN** the call fails with "deposit does not cover the enclave run"

### Requirement: Approved applicants only
The enclave SHALL issue an attestation only for the Sumsub level it serves (level 2), and only when the applicant for this contract, gateway and wallet is reviewed as `completed` and `GREEN`. Otherwise it SHALL return null.

#### Scenario: Pending review
- **WHEN** the Sumsub applicant review is not completed
- **THEN** no attestation is stored and `verify` resolves to false

### Requirement: Applicant session id is unlinkable
The relay and the enclave SHALL derive the Sumsub external user id as `gateflow-` + hex HMAC-SHA256 of `{contract}:{gateway}:{wallet}` under a shared secret, so Sumsub never sees the wallet in clear.

#### Scenario: Same input, same id
- **WHEN** the relay and the enclave derive the id for the same contract, gateway and wallet
- **THEN** both ids are identical

### Requirement: Chain stores only a nullifier
An attestation SHALL contain only a nullifier, a level and an expiry 30 days out. The nullifier SHALL be hex HMAC-SHA256 of `{document number}:{country}:{contract}:{gateway}` under an enclave-only secret, so the same person gets the same nullifier on one gateway and unrelated nullifiers across gateways.

#### Scenario: Two wallets, one person
- **WHEN** one person verifies two wallets on the same gateway
- **THEN** both attestations carry the same nullifier and share the 24-hour spend limit

### Requirement: Attestation validity
An attestation SHALL count as valid for a required level only if its level is at least that level, it has not expired, and its nullifier is not revoked on that gateway. Expired or out-of-range attestations returned by the enclave SHALL NOT be stored.

#### Scenario: Expired attestation
- **WHEN** a payer's attestation expired yesterday
- **THEN** `is_verified` returns false for any level

### Requirement: Merchant revocation
The system SHALL let only the gateway owner revoke a nullifier on that gateway, log `REVOKED`, and treat every attestation with that nullifier as invalid on that gateway.

#### Scenario: Revoked person
- **WHEN** the owner revokes a nullifier
- **THEN** every wallet attested with it fails `is_verified` on that gateway

### Requirement: Verification deposit handling
The system SHALL forward the verification deposit to OutLayer with the wallet as the payer of the execution, and SHALL return the deposit to the wallet when the execution fails.

#### Scenario: Enclave unavailable
- **WHEN** the OutLayer execution for `verify` fails
- **THEN** the wallet gets its deposit back and `verify` resolves to false
