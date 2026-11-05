## MODIFIED Requirements

### Requirement: Pay from another chain
The page SHALL let the payer pick an origin chain from the relay's same-asset quotable assets for the invoice. The chains SHALL be shown as a list with one row per chain, each with its chain icon and name. Ethereum L2s SHALL be nested under Ethereum, and the selected row SHALL be marked with a check. The payer SHALL enter a refund address on that chain (used if the swap fails) and a NEAR account (used if screening returns the payment), and request a quote. The page SHALL then show the exact amount to send with a copy action, the deposit address with a QR code and copy action, an optional memo, and the quote deadline as a countdown.

#### Scenario: Bitcoin for an nBTC invoice
- **WHEN** the payer picks Bitcoin, enters a `bc1q…` refund address and a NEAR account, and requests a quote for an invoice of 0.01 `nbtc.bridge.near`, shown as 0.01 BTC
- **THEN** the page shows the BTC amount to send, a Bitcoin deposit address and a QR code

#### Scenario: Missing refund address
- **WHEN** the payer requests a quote without the origin refund address or the NEAR account
- **THEN** the page asks for the missing field and requests no quote

#### Scenario: Chains of a USDC invoice
- **WHEN** the payer opens the cross-chain option of a 1 USDC invoice and the relay returns USDC on Base, Arbitrum and Ethereum
- **THEN** the page lists Ethereum first, with Base and Arbitrum indented beneath it, each row labeled with the chain name only, and no other token

#### Scenario: L2s without Ethereum
- **WHEN** the relay returns the invoice's asset on Base and Arbitrum but not on Ethereum
- **THEN** the page lists Base and Arbitrum as top-level rows and shows no Ethereum row

#### Scenario: Chains outside Ethereum
- **WHEN** the relay returns the invoice's asset on Ethereum, Base and Bitcoin
- **THEN** the page lists Ethereum, then Base indented beneath it, then Bitcoin at the top level

#### Scenario: Selected chain marked
- **WHEN** the payer picks Base
- **THEN** the Base row shows a check, is reported as pressed to assistive technology, and no other row shows a check

#### Scenario: Amount copied
- **WHEN** the quote asks for 1.010225 USDC and the payer uses the amount's copy action
- **THEN** the clipboard holds `1.010225`

#### Scenario: No chain available
- **WHEN** the relay returns no quotable asset for the invoice
- **THEN** the page says the invoice can only be paid with a NEAR wallet and offers no quote request
