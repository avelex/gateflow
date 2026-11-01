# Spec Delta

## REMOVED Requirements

### Requirement: Verify through the TEE
**Reason**: Sumsub KYC is removed; Gateflow screens payers with KYT only.
**Migration**: None. `verify` no longer exists; payers pay without verifying.

### Requirement: Approved applicants only
**Reason**: There is no identity provider in the enclave any more.
**Migration**: None.

### Requirement: Applicant session id is unlinkable
**Reason**: There are no Sumsub applicants, so no session ids.
**Migration**: Drop `SESSION_ID_SECRET` from the relay and the OutLayer secrets.

### Requirement: Chain stores only a nullifier
**Reason**: No attestations are stored.
**Migration**: Drop `NULLIFIER_SECRET` from the OutLayer secrets.

### Requirement: Attestation validity
**Reason**: No attestations exist.
**Migration**: `is_verified` and `get_attestation` are removed. Callers stop querying identity.

### Requirement: Merchant revocation
**Reason**: Without nullifiers there is nothing to revoke.
**Migration**: `revoke` is removed. To block a payer, a merchant lowers `max_risk`.

### Requirement: Verification deposit handling
**Reason**: There is no verification execution to pay for.
**Migration**: None.
