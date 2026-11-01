# Spec Delta

## REMOVED Requirements

### Requirement: Identity policy enforced at deposit
**Reason**: Gateway policies no longer carry verification levels or a threshold; every payment is screened by KYT only.
**Migration**: None. Payments that previously required an attestation are now accepted and screened like any other.

### Requirement: 24-hour spend limit per person
**Reason**: The limit was keyed by the identity nullifier, which no longer exists.
**Migration**: None. Large payments are gated only by the screening verdict and `max_risk`.
