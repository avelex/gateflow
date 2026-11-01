# Spec Delta

## MODIFIED Requirements

### Requirement: Cross-chain checkout quote
`POST /checkout/quote` with `{gateway, originAsset, amount, refundTo, refundOnNear}` SHALL generate a random 128-bit hex `ref` and request a 1Click `EXACT_OUTPUT` quote that delivers the gateway's token on NEAR, with the Gateflow contract as recipient and `{"gateway", "ref", "refund_to"}` as `customRecipientMsg`. It SHALL return the deposit address, optional memo, input amount, deadline and `ref`.

#### Scenario: Quote returned
- **WHEN** the page asks for 10 USDC on a screening-only gateway
- **THEN** the relay returns a deposit address on the origin chain, the input amount to send, and a `ref`

#### Scenario: Missing NEAR refund account
- **WHEN** the request has no valid `refundOnNear`
- **THEN** the relay answers 400 "not a NEAR account id"

#### Scenario: BTC into an nBTC gateway
- **WHEN** the page asks for 0.001 BTC from native Bitcoin on a gateway whose token is `nbtc.bridge.near`
- **THEN** the quote's destination asset is `nep141:nbtc.bridge.near` and the deposit address is on Bitcoin

#### Scenario: ZEC into a ZEC gateway
- **WHEN** the page asks for ZEC on a gateway whose token is `zec.omft.near`
- **THEN** the quote's destination asset is the NEAR-delivered `1cs_v1:near:nep141:zec.omft.near`

## ADDED Requirements

### Requirement: Only screenable origins are quoted
The relay SHALL quote only origin assets whose 1Click chain is a configured EVM chain, Bitcoin or Zcash, and SHALL answer 422 "this origin chain can't be screened" for any other origin, so no payer pays fees for a payment that will always be refunded.

#### Scenario: Unsupported origin
- **WHEN** the page asks for a quote from a Solana asset
- **THEN** the relay answers 422 and requests no quote

### Requirement: Trigger deferred screening
`POST /checkout/screen` with `{depositAddress, ref}` SHALL check that 1Click reports `SUCCESS` for the deposit address, find the payment opened with that `ref`, and submit `screen_intents(payment, depositAddress)` from the relay's NEAR account, paying its gas. It SHALL return the payment id and the NEAR transaction hash.

#### Scenario: Swap delivered
- **WHEN** the page posts a deposit address with status `SUCCESS` and a `ref` that has a Pending payment
- **THEN** the relay submits `screen_intents` and returns `{payment, txHash}`

#### Scenario: Swap still running
- **WHEN** the 1Click status is not `SUCCESS`
- **THEN** the relay answers 409 with the current status and submits nothing

#### Scenario: Unknown ref
- **WHEN** no payment exists for the `ref`
- **THEN** the relay answers 404 and submits nothing
