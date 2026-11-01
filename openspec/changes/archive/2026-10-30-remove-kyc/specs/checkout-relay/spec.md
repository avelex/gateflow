# Spec Delta

## REMOVED Requirements

### Requirement: Mint a Sumsub WebSDK token
**Reason**: Sumsub KYC is removed.
**Migration**: `POST /relay/token` no longer exists; checkout pages stop calling it. Drop `SUMSUB_RELAY_APP_TOKEN`, `SUMSUB_RELAY_SECRET_KEY` and `SUMSUB_LEVEL_NAME` from the relay environment.

### Requirement: Token mint rate limit
**Reason**: There are no tokens to mint.
**Migration**: None.

### Requirement: Identity-gated amounts are not quoted
**Reason**: No payment amount requires identity any more.
**Migration**: None. Quotes for any amount proceed to the origin-chain check.
