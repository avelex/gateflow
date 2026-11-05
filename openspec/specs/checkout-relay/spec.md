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
`GET /checkout/invoice?id=<invoice id>` SHALL return the invoice's amount, token symbol and decimals, expiry, status and gateway, the merchant's display name, the Gateflow contract account, and, when the invoice has a payment, that payment's status and refund account. It SHALL also return `enclave` with the configured OutLayer project and its active wasm hash, `screening` with the payment's screening evidence or null, and `times` with the UTC seconds the deposit was seen, the payment opened, screened and closed, each null when unknown. It SHALL answer 404 for an unknown invoice.

#### Scenario: Paying invoice
- **WHEN** the page requests an invoice whose payment is Pending
- **THEN** the response has invoice status `Paying` and payment status `Pending`

#### Scenario: Unknown invoice
- **WHEN** the page requests an invoice id that does not exist
- **THEN** the relay answers 404

#### Scenario: Contract account included
- **WHEN** the relay runs with `GATEFLOW_CONTRACT` `gateflow.near` and the page requests an Open invoice
- **THEN** the response's `contract` is `gateflow.near`

#### Scenario: Enclave facts included
- **WHEN** `outlayer.near` reports active version `11a4ef…` for project `ops.gateflow.near/gateflow` and the page requests an Open invoice
- **THEN** the response's `enclave` is `{project: "ops.gateflow.near/gateflow", activeVersion: "11a4ef…"}` and `screening` is null

#### Scenario: Screened invoice
- **WHEN** the page requests a Paid invoice whose payment has stored evidence
- **THEN** the response's `screening` carries the transaction hash, request id, wasm hash, run time, cost and outcome `approved`

#### Scenario: OutLayer unavailable
- **WHEN** reading the active version fails
- **THEN** the response still returns the invoice with `enclave.activeVersion` null

#### Scenario: Times of a paid cross-chain invoice
- **WHEN** the page requests a Paid invoice whose deposit the watcher saw at 1793857780, whose payment opened at 1793857812, and whose evidence has `screenedAtSec` 1793857840 and `closedAtSec` 1793857841
- **THEN** `times` is `{depositSeenAtSec: 1793857780, openedAtSec: 1793857812, screenedAtSec: 1793857840, closedAtSec: 1793857841}`

#### Scenario: Open invoice
- **WHEN** the page requests an Open invoice without a payment
- **THEN** every field of `times` is null

### Requirement: Quotable origin assets
`GET /checkout/assets` SHALL return the 1Click assets on a screenable chain (the configured EVM chains, Bitcoin and Zcash) with asset id, chain and symbol. With `?invoice=<id>` it SHALL return only those with the same `coingeckoId` and symbol as the 1Click asset of the invoice's token, at most one per chain, and SHALL answer 400 for an invalid id and 404 for an unknown invoice.

#### Scenario: Solana excluded
- **WHEN** the page requests quotable assets for a BTC invoice
- **THEN** the list contains Bitcoin BTC and no Solana asset

#### Scenario: USDC invoice
- **WHEN** the page requests quotable assets for an invoice in the NEAR USDC token and 1Click lists USDC and sUSDC on Base (both `usd-coin`), USDC on Arbitrum and Ethereum, and USDT on Ethereum
- **THEN** the list is exactly USDC on Base, USDC on Arbitrum and USDC on Ethereum

#### Scenario: BTC invoice
- **WHEN** the page requests quotable assets for an invoice in `nbtc.bridge.near` and 1Click lists native BTC, `BTC(OMNI)`, cbBTC and WBTC
- **THEN** the list is exactly one Bitcoin BTC asset

#### Scenario: Without an invoice
- **WHEN** the console's Settings requests quotable assets without an invoice
- **THEN** the list holds every asset on a screenable chain, of any token

#### Scenario: Token not on 1Click
- **WHEN** the invoice's token has no 1Click asset
- **THEN** the list is empty

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

### Requirement: Active enclave version is cached
The relay SHALL read the project's active version from the OutLayer contract at most once per 60 seconds and serve the cached value in between.

#### Scenario: Polling page
- **WHEN** a checkout page polls the invoice every 5 seconds for one minute
- **THEN** the relay reads the active version from OutLayer at most twice

### Requirement: Direct payment transaction report
`POST /checkout/tx` with `{invoice, txHash}` SHALL record `txHash` as the screening transaction of the invoice's payment only when the NEAR transaction, looked up with the payment's payer as signer, contains the Gateflow contract's `payment_opened` event for that payment. It SHALL answer 400 for a malformed hash, 404 when the invoice has no payment, and 422 when the transaction does not match.

#### Scenario: Wallet hash accepted
- **WHEN** the page reports the hash of the payer's `ft_transfer_call` that opened payment 3 for invoice 7
- **THEN** the relay records it for payment 3 and answers `{payment: 3}`

#### Scenario: Unrelated transaction
- **WHEN** the page reports a hash whose transaction opened a different payment or none
- **THEN** the relay answers 422 and records nothing

#### Scenario: Not paid yet
- **WHEN** the page reports a hash for an invoice that has no payment yet
- **THEN** the relay answers 404 and records nothing

### Requirement: Quote only the invoice's asset
`POST /checkout/quote` SHALL answer 422 and request no quote when `originAsset` is not among the invoice's quotable origin assets.

#### Scenario: Other token refused
- **WHEN** the page asks for a quote on a USDC invoice with `originAsset` ETH on Base
- **THEN** the relay answers 422 and calls no 1Click quote

### Requirement: Deposit seen time
The watcher SHALL record, per quote, the time it first sees a 1Click status other than `PENDING_DEPOSIT` or `UNKNOWN`, and SHALL NOT change it afterwards.

#### Scenario: Deposit first seen
- **WHEN** the watcher reads `PENDING_DEPOSIT` at 05:49:25 and `PROCESSING` at 05:49:40 UTC for a quote
- **THEN** the quote's deposit-seen time is 05:49:40 UTC, and later ticks leave it unchanged

### Requirement: Origin sender of a cross-chain payment
When 1Click reports `SUCCESS` for a quote, the watcher SHALL resolve the addresses that sent the deposit from `originChainTxHashes` and store them with the quote's origin chain: the EVM `from`, every Bitcoin input address, or every transparent Zcash input address. A failed lookup SHALL be retried on later ticks while the quote is watched.

#### Scenario: Base sender
- **WHEN** a Base USDC quote reaches `SUCCESS` with origin tx `0xe16b…` sent from `0x12AB…CD`
- **THEN** the quote stores chain `base` and senders `["0x12ab…cd"]` in lowercase

#### Scenario: Bitcoin with two inputs
- **WHEN** a BTC quote reaches `SUCCESS` and its origin tx spends inputs from `bc1qa…` and `bc1qb…`
- **THEN** the quote stores chain `btc` and both addresses

#### Scenario: Lookup fails
- **WHEN** the origin chain endpoint fails during a tick
- **THEN** no senders are stored and the next tick tries again

### Requirement: Token display symbol
Every relay response that carries a token symbol SHALL show `nbtc.bridge.near` as `BTC`. Other tokens SHALL keep the symbol from their `ft_metadata`.

#### Scenario: nBTC invoice
- **WHEN** the page requests an invoice in `nbtc.bridge.near`
- **THEN** the response's `symbol` is `BTC`
