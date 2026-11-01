# Spec Delta

## Purpose

Gives the checkout page the off-chain calls it cannot make itself: Sumsub WebSDK tokens for KYC and NEAR Intents 1Click quotes that deliver a cross-chain payment into a gateway. The relay keeps no state.

## ADDED Requirements

### Requirement: Mint a Sumsub WebSDK token
`POST /relay/token` with `{gateway, wallet}` SHALL create or reuse the Sumsub applicant under the unlinkable session id for that contract, gateway and wallet, and SHALL return a 10-minute access token for the configured Sumsub level.

#### Scenario: Token minted
- **WHEN** the page posts a valid gateway id and NEAR account
- **THEN** the relay returns `{token}`

#### Scenario: Invalid wallet
- **WHEN** `wallet` is not a valid NEAR account id
- **THEN** the relay answers 400 "not a NEAR account id"

### Requirement: Token mint rate limit
The relay SHALL allow at most 5 token mints per client IP per hour and SHALL answer 429 beyond that.

#### Scenario: Sixth mint in an hour
- **WHEN** one IP requests a sixth token within an hour
- **THEN** the relay answers 429 "too many verification sessions from this address"

### Requirement: Cross-chain checkout quote
`POST /checkout/quote` with `{gateway, originAsset, amount, refundTo, refundOnNear?}` SHALL request a 1Click `EXACT_OUTPUT` quote from the origin chain to the gateway's token, with the Gateflow contract as recipient and `{"gateway", "refund_to"}` as `customRecipientMsg`. It SHALL return the deposit address, optional memo, input amount and deadline.

#### Scenario: Quote returned
- **WHEN** the page asks for 10 USDC on a screening-only gateway
- **THEN** the relay returns a deposit address on the origin chain and the input amount to send

### Requirement: Identity-gated amounts are not quoted
The relay SHALL refuse a quote with 422 when the gateway policy requires a verification level for that amount, because identity is bound to a NEAR wallet that pays directly.

#### Scenario: Amount above threshold
- **WHEN** the amount is at or above the threshold of a gateway with `level_above = 2`
- **THEN** the relay answers 422 "this amount needs a verified NEAR wallet, pay from it directly"

### Requirement: Checkout status
`GET /checkout/status?depositAddress=` SHALL return the 1Click execution status for that deposit address.

#### Scenario: Status passthrough
- **WHEN** the page polls a deposit address that 1Click has settled
- **THEN** the relay returns `{status: "SUCCESS"}`

### Requirement: Error mapping
The relay SHALL answer 404 for unknown routes and gateways, 400 for invalid input, and 502 for upstream failures, always as JSON `{error}` with permissive CORS.

#### Scenario: Upstream failure
- **WHEN** the 1Click quote call fails
- **THEN** the relay answers 502 with the upstream status in `error`
