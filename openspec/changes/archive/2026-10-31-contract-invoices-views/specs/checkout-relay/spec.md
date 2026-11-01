# Spec Delta

## MODIFIED Requirements

### Requirement: Cross-chain checkout quote
`POST /checkout/quote` with `{invoice, originAsset, refundTo, refundOnNear}` SHALL read the invoice from the Gateflow contract, generate a random 128-bit hex `ref`, and request a 1Click `EXACT_OUTPUT` quote that delivers the invoice's amount in the invoice's token on NEAR, with the Gateflow contract as recipient and `{"gateway", "invoice", "ref", "refund_to"}` as `customRecipientMsg`. It SHALL return the deposit address, optional memo, input amount, deadline and `ref`.

#### Scenario: Quote returned
- **WHEN** the page asks for a quote on an Open invoice of 10 USDC
- **THEN** the relay returns a deposit address on the origin chain, the input amount to send, and a `ref`

#### Scenario: Missing NEAR refund account
- **WHEN** the request has no valid `refundOnNear`
- **THEN** the relay answers 400 "not a NEAR account id"

#### Scenario: BTC into an nBTC gateway
- **WHEN** the page asks for a quote from native Bitcoin on an invoice of 0.001 nBTC (`nbtc.bridge.near`)
- **THEN** the quote's destination asset is `nep141:nbtc.bridge.near`, its output amount is 0.001 nBTC, and the deposit address is on Bitcoin

#### Scenario: ZEC into a ZEC gateway
- **WHEN** the page asks for a quote on an invoice in `zec.omft.near`
- **THEN** the quote's destination asset is the NEAR-delivered `1cs_v1:near:nep141:zec.omft.near`

#### Scenario: Invoice not payable
- **WHEN** the invoice is not Open or its expiry has passed
- **THEN** the relay answers 409 and requests no quote

### Requirement: Error mapping
The relay SHALL answer 404 for unknown routes, gateways and invoices, 400 for invalid input, and 502 for upstream failures, always as JSON `{error}` with permissive CORS.

#### Scenario: Upstream failure
- **WHEN** the 1Click quote call fails
- **THEN** the relay answers 502 with the upstream status in `error`

#### Scenario: Unknown invoice
- **WHEN** the page asks for a quote on an invoice id that does not exist
- **THEN** the relay answers 404
