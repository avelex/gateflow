## MODIFIED Requirements

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

## ADDED Requirements

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
