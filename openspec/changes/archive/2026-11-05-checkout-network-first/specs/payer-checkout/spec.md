## ADDED Requirements

### Requirement: Choose the network first
For an Open invoice, the payment column SHALL first ask "Pay <symbol> from" with a list of networks: NEAR on top, then the relay's same-asset quotable origin chains, with Ethereum L2s nested under Ethereum and a check on the selected row. Until a network is picked, the page SHALL show no payment method, form or pay button.

#### Scenario: Nothing picked yet
- **WHEN** a payer opens an Open 0.01 USDC invoice
- **THEN** the column shows "Pay USDC from" and the network list, and no method tiles, form or pay button

#### Scenario: Asset list fails to load
- **WHEN** the relay's asset list request fails
- **THEN** the list shows NEAR alone

### Requirement: Payment methods per network
After a network is picked, the page SHALL show two method tiles, Browser wallet and Address or QR. It SHALL enable and select the one method that network supports and show the other as disabled with its reason. NEAR SHALL support Browser wallet only. Every other network SHALL support Address or QR only.

#### Scenario: NEAR picked
- **WHEN** the payer picks NEAR
- **THEN** Browser wallet is selected, and Address or QR is disabled with the reason that NEAR pays from a wallet

#### Scenario: Arbitrum picked
- **WHEN** the payer picks Arbitrum
- **THEN** Address or QR is selected, and Browser wallet is disabled with the reason that wallet payment from Arbitrum is not available yet

#### Scenario: Switching network
- **WHEN** the payer picks Arbitrum, then NEAR
- **THEN** the Address or QR form disappears and the NEAR wallet option shows

## MODIFIED Requirements

### Requirement: Pay with a NEAR wallet
The page SHALL offer paying from a NEAR wallet through wallet-selector by calling `ft_transfer_call` on the invoice token to the Gateflow contract with the invoice amount and `msg` `{"invoice": <id>}`. Before payment it SHALL warn that current screening refunds payments sent from named NEAR accounts such as `alice.near`, and that paying from another chain avoids this.

#### Scenario: Named account warned
- **WHEN** a payer picks NEAR
- **THEN** the page shows the named-account warning, pointing to paying from another chain, before the wallet opens

#### Scenario: Direct payment sent
- **WHEN** the wallet confirms the transfer
- **THEN** the page switches to the status timeline for that invoice

#### Scenario: Message names the invoice only
- **WHEN** a payer pays invoice 7 from a NEAR wallet
- **THEN** the `ft_transfer_call` carries `msg` exactly `{"invoice":7}`, with no gateway field

### Requirement: Pay from another chain
After the payer picks a network other than NEAR, the page SHALL let them enter a refund address on that chain (used if the swap fails) and a NEAR account (used if screening returns the payment), and request a quote for the invoice's asset on that chain. The page SHALL then show the exact amount to send with a copy action, the deposit address with a QR code and copy action, an optional memo, and the quote deadline as a countdown.

#### Scenario: Bitcoin for an nBTC invoice
- **WHEN** the payer picks Bitcoin, enters a `bc1q…` refund address and a NEAR account, and requests a quote for an invoice of 0.01 `nbtc.bridge.near`, shown as 0.01 BTC
- **THEN** the page shows the BTC amount to send, a Bitcoin deposit address and a QR code

#### Scenario: Missing refund address
- **WHEN** the payer requests a quote without the origin refund address or the NEAR account
- **THEN** the page asks for the missing field and requests no quote

#### Scenario: Chains of a USDC invoice
- **WHEN** the payer opens a 1 USDC invoice and the relay returns USDC on Base, Arbitrum and Ethereum
- **THEN** the network list shows NEAR, then Ethereum with Base and Arbitrum indented beneath it, each row labeled with the network name only, and no other token

#### Scenario: L2s without Ethereum
- **WHEN** the relay returns the invoice's asset on Base and Arbitrum but not on Ethereum
- **THEN** the list shows NEAR, Base and Arbitrum as top-level rows and no Ethereum row

#### Scenario: Chains outside Ethereum
- **WHEN** the relay returns the invoice's asset on Ethereum, Base and Bitcoin
- **THEN** the list shows NEAR, Ethereum, Base indented beneath Ethereum, then Bitcoin at the top level

#### Scenario: Selected chain marked
- **WHEN** the payer picks Base
- **THEN** the Base row shows a check, is reported as pressed to assistive technology, no other row shows a check, and the refund field is labeled "Refund address on Base"

#### Scenario: Amount copied
- **WHEN** the quote asks for 1.010225 USDC and the payer uses the amount's copy action
- **THEN** the clipboard holds `1.010225`

#### Scenario: No chain available
- **WHEN** the relay returns no quotable asset for the invoice
- **THEN** the network list shows NEAR alone and the page offers no quote request
