## MODIFIED Requirements

### Requirement: Only screenable origins are quoted
The relay SHALL quote only origin assets whose 1Click chain is a configured EVM chain, Solana, Bitcoin or Zcash, and SHALL answer 422 "this origin chain can't be screened" for any other origin, so no payer pays fees for a payment that will always be refunded.

#### Scenario: Unsupported origin
- **WHEN** the page asks for a quote from a TRON asset
- **THEN** the relay answers 422 and requests no quote

#### Scenario: Solana origin
- **WHEN** the page asks for a quote from USDC on Solana for an Open USDC invoice
- **THEN** the relay returns a Solana deposit address, the input amount to send and a `ref`

### Requirement: Quotable origin assets
`GET /checkout/assets` SHALL return the 1Click assets on a screenable chain (the configured EVM chains, Solana, Bitcoin and Zcash) with asset id, chain and symbol. With `?invoice=<id>` it SHALL return only those with the same `coingeckoId` and symbol as the 1Click asset of the invoice's token, at most one per chain, and SHALL answer 400 for an invalid id and 404 for an unknown invoice.

#### Scenario: Solana excluded
- **WHEN** the page requests quotable assets for a BTC invoice and 1Click lists BTC only on Bitcoin and USDC on Solana
- **THEN** the list contains Bitcoin BTC and no Solana asset, because no Solana asset matches the invoice's token

#### Scenario: Unscreenable chain excluded
- **WHEN** the page requests quotable assets for a USDC invoice and 1Click also lists USDC on TRON
- **THEN** the list has no TRON asset

#### Scenario: USDC invoice
- **WHEN** the page requests quotable assets for an invoice in the NEAR USDC token and 1Click lists USDC and sUSDC on Base (both `usd-coin`), USDC on Arbitrum, Ethereum and Solana, and USDT on Ethereum
- **THEN** the list is exactly USDC on Base, USDC on Arbitrum, USDC on Ethereum and USDC on Solana

#### Scenario: BTC invoice
- **WHEN** the page requests quotable assets for an invoice in `nbtc.bridge.near` and 1Click lists native BTC, `BTC(OMNI)`, cbBTC and WBTC
- **THEN** the list is exactly one Bitcoin BTC asset

#### Scenario: Without an invoice
- **WHEN** the console's Settings requests quotable assets without an invoice
- **THEN** the list holds every asset on a screenable chain, of any token

#### Scenario: Token not on 1Click
- **WHEN** the invoice's token has no 1Click asset
- **THEN** the list is empty

### Requirement: Origin sender of a cross-chain payment
When 1Click reports `SUCCESS` for a quote, the watcher SHALL resolve the addresses that sent the deposit from `originChainTxHashes` and store them with the quote's origin chain: the EVM `from`, every Solana signer, every Bitcoin input address, or every transparent Zcash input address. A failed lookup SHALL be retried on later ticks while the quote is watched.

#### Scenario: Base sender
- **WHEN** a Base USDC quote reaches `SUCCESS` with origin tx `0xe16b…` sent from `0x12AB…CD`
- **THEN** the quote stores chain `base` and senders `["0x12ab…cd"]` in lowercase

#### Scenario: Solana signers
- **WHEN** a Solana USDC quote reaches `SUCCESS` and its origin tx is signed by a fee payer `Fee1…` and an owner `Own1…`
- **THEN** the quote stores chain `sol` and both addresses in signer order, with case kept

#### Scenario: Bitcoin with two inputs
- **WHEN** a BTC quote reaches `SUCCESS` and its origin tx spends inputs from `bc1qa…` and `bc1qb…`
- **THEN** the quote stores chain `btc` and both addresses

#### Scenario: Lookup fails
- **WHEN** the origin chain endpoint fails during a tick
- **THEN** no senders are stored and the next tick tries again
