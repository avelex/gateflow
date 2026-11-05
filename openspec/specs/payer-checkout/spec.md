# payer-checkout Specification

## Purpose

Gives a payer a public page for one invoice where they pay from a NEAR wallet or from another chain and can follow their payment until it is released to the merchant or returned to them.

## Requirements

### Requirement: Invoice page
`/pay/<invoice id>` SHALL show the merchant name, the amount and token, the invoice id and expiry countdown, and a short explanation that funds are held in the Gateflow contract, screened in an enclave, then released to the merchant or returned. It SHALL need no sign-in and SHALL collect no personal data.

#### Scenario: Open invoice
- **WHEN** a payer opens the link of an Open invoice of 0.01 nBTC from Kaja Coffee
- **THEN** the page shows "Kaja Coffee", "0.01 nBTC" and the time left

#### Scenario: Unknown invoice
- **WHEN** a payer opens `/pay/999999` and the invoice does not exist
- **THEN** the page shows "Invoice not found" and no payment options

### Requirement: Unpayable invoice
For an invoice that is Paid, Returned, or Open past its expiry, the page SHALL show that state and SHALL NOT offer payment options.

#### Scenario: Expired
- **WHEN** a payer opens an invoice whose expiry has passed
- **THEN** the page shows "This invoice has expired" and no payment options

### Requirement: Pay with a NEAR wallet
The page SHALL offer paying from a NEAR wallet through wallet-selector by calling `ft_transfer_call` on the invoice token to the Gateflow contract with the invoice amount and `msg` `{"invoice": <id>}`. Before payment it SHALL warn that current screening refunds payments sent from named NEAR accounts such as `alice.near`, and that paying from another chain avoids this.

#### Scenario: Named account warned
- **WHEN** a payer chooses the NEAR wallet option
- **THEN** the page shows the named-account warning, pointing to paying from another chain, before the wallet opens

#### Scenario: Direct payment sent
- **WHEN** the wallet confirms the transfer
- **THEN** the page switches to the status timeline for that invoice

#### Scenario: Message names the invoice only
- **WHEN** a payer pays invoice 7 from a NEAR wallet
- **THEN** the `ft_transfer_call` carries `msg` exactly `{"invoice":7}`, with no gateway field

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

### Requirement: Status timeline
After payment starts, the page SHALL show four steps and advance them from backend status: Deposit detected (cross-chain only), Delivered to contract (payment opened), Screening in enclave, then Released to merchant or Returned to you. Each completed step whose time the relay reports SHALL show that time in UTC. The page SHALL say the payer may close it and that the payment continues.

#### Scenario: Released
- **WHEN** the invoice becomes Paid
- **THEN** the last step shows "Released to merchant"

#### Scenario: Returned
- **WHEN** the invoice becomes Returned
- **THEN** the last step shows "Returned to you" with the refund destination

#### Scenario: Step times shown
- **WHEN** the invoice is Paid and the relay reports the deposit seen at 05:49:40, the payment opened at 05:50:12, screened at 05:50:40 and closed at 05:50:41 UTC
- **THEN** the four steps show those times, each marked UTC

#### Scenario: Time unknown
- **WHEN** a completed step has no reported time
- **THEN** that step shows no time and the other steps are unaffected

#### Scenario: Screening evidence shown
- **WHEN** the invoice's screening outcome is `approved` or `rejected`
- **THEN** the Screening in enclave step shows the OutLayer request id, the short wasm hash and the run time, with links to the NEAR explorer transaction and to OutLayer executions

#### Scenario: Attestation linked
- **WHEN** the invoice's screening outcome is `approved` or `rejected` and its `jobId` is 1255332 on mainnet
- **THEN** the OutLayer link opens `https://app.outlayer.ai/attestation/1255332?network=mainnet` and is labeled as the attestation

#### Scenario: Returned without a verdict
- **WHEN** the invoice is Returned and its screening outcome is `failed` or `no_verdict`
- **THEN** the Screening in enclave step says the enclave returned no verdict (`failed`) or no verdict arrived within 15 minutes (`no_verdict`), and shows no request id or wasm hash as the screening code

#### Scenario: No evidence recorded
- **WHEN** the invoice is decided and its screening is null
- **THEN** the Screening in enclave step says the screening record is unavailable and links to OutLayer executions

### Requirement: Direct payment reports its transaction
After a NEAR wallet payment, the page SHALL report the wallet's transaction hash to the backend, both when the wallet returns it directly and when a redirect wallet returns it in the URL. It SHALL retry while the backend answers 404 and stop after acceptance or a 422.

#### Scenario: Redirect wallet
- **WHEN** a redirect wallet returns to `/pay/7?transactionHashes=8Kd…`
- **THEN** the page reports `8Kd…` for invoice 7

#### Scenario: Payment not opened yet
- **WHEN** the first report answers 404
- **THEN** the page reports again on its next poll

### Requirement: Quote fee shown
With a quote shown, the page SHALL state how much of the amount to send exceeds the invoice amount, as the 1Click fee and slippage buffer, in the origin token.

#### Scenario: USDC from Base
- **WHEN** a 1 USDC invoice is quoted from Base with `amountIn` 1.010225 USDC
- **THEN** the page says 0.010225 USDC of it covers the 1Click fee and slippage buffer
