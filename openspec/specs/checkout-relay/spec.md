# checkout-relay Specification

## Purpose

The checkout API of the Gateflow backend: public invoice details, NEAR Intents 1Click quotes that deliver a cross-chain payment into an invoice, quote status, and deferred screening. The backend records each quote it issues and submits `screen_intents` itself once the deposit arrives.

## Requirements

### Requirement: Cross-chain checkout quote
`POST /checkout/quote` with `{invoice, originAsset, refundTo, refundOnNear}` SHALL read the invoice from the Gateflow contract, generate a random 128-bit hex `ref`, and request a 1Click `EXACT_OUTPUT` quote that delivers the invoice's amount in the invoice's token on NEAR, with the Gateflow contract as recipient and `{"invoice", "ref", "refund_to"}` as `customRecipientMsg`. It SHALL return the deposit address, optional memo, input amount, deadline and `ref`.

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

#### Scenario: Message names the invoice, not the gateway
- **WHEN** the relay requests a quote for invoice 7 with `refundOnNear` `bob.near`
- **THEN** the quote's `customRecipientMsg` is exactly `{"invoice":7,"ref":<ref>,"refund_to":"bob.near"}`

### Requirement: Checkout status
`GET /checkout/status?depositAddress=` SHALL return the 1Click execution status for that deposit address.

#### Scenario: Status passthrough
- **WHEN** the page polls a deposit address that 1Click has settled
- **THEN** the relay returns `{status: "SUCCESS"}`

### Requirement: Error mapping
The relay SHALL answer 404 for unknown routes, gateways and invoices, 400 for invalid input, and 502 for upstream failures, always as JSON `{error}` with permissive CORS.

#### Scenario: Upstream failure
- **WHEN** the 1Click quote call fails
- **THEN** the relay answers 502 with the upstream status in `error`

#### Scenario: Unknown invoice
- **WHEN** the page asks for a quote on an invoice id that does not exist
- **THEN** the relay answers 404

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


### Requirement: Checkout invoice details
`GET /checkout/invoice?id=<invoice id>` SHALL return the invoice's amount, token symbol and decimals, expiry, status and gateway, the merchant's display name, and, when the invoice has a payment, that payment's status and refund account. It SHALL answer 404 for an unknown invoice.

#### Scenario: Paying invoice
- **WHEN** the page requests an invoice whose payment is Pending
- **THEN** the response has invoice status `Paying` and payment status `Pending`

#### Scenario: Unknown invoice
- **WHEN** the page requests an invoice id that does not exist
- **THEN** the relay answers 404

### Requirement: Quotable origin assets
`GET /checkout/assets` SHALL return the 1Click assets whose chain can be screened (the configured EVM chains, Bitcoin and Zcash) with asset id, chain and symbol.

#### Scenario: Solana excluded
- **WHEN** the page requests quotable assets
- **THEN** the list contains Bitcoin BTC and no Solana asset

### Requirement: Backend-driven deferred screening
The backend SHALL record each quote it issues with its `ref`, deposit address, invoice and deadline, poll 1Click for its status, and once the status is `SUCCESS` and a payment with that `ref` exists, submit `screen_intents` itself. It SHALL stop polling a quote after screening was submitted, after 1Click reports `REFUNDED` or `FAILED`, or one hour after the quote deadline.

#### Scenario: Payer closed the tab
- **WHEN** the payer sends the deposit and closes the page, and 1Click later reports `SUCCESS`
- **THEN** the backend submits `screen_intents` for that payment without any page request

#### Scenario: Swap refunded by 1Click
- **WHEN** 1Click reports `REFUNDED` for a recorded quote
- **THEN** the backend stops polling it and submits nothing

### Requirement: Quote status for the page
`GET /checkout/status?depositAddress=` SHALL return the 1Click status of a recorded quote together with whether the backend has submitted screening for it.

#### Scenario: Screening submitted
- **WHEN** the page polls a deposit address whose screening the backend submitted
- **THEN** the response carries the 1Click status `SUCCESS` and `screening: true`
