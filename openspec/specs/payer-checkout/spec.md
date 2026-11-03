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

#### Scenario: Screening explained
- **WHEN** a payer expands "How screening works" on an Open invoice
- **THEN** the page lists the checks run (risk score of the paying address, OFAC lists for Bitcoin and Zcash senders, the cross-chain swap matching the invoice), says the checks run in an Intel TDX enclave (TEE) operated by OutLayer, and shows the OutLayer project and its current wasm hash

#### Scenario: Current code unknown
- **WHEN** the invoice details carry no active wasm hash
- **THEN** the explanation shows the project without a hash and claims no code version

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
The page SHALL let the payer pick an origin asset from the quotable 1Click assets, enter a refund address on that chain (used if the swap fails) and a NEAR account (used if screening returns the payment), and request a quote. It SHALL then show the exact amount to send, the deposit address with a QR code and copy action, an optional memo, and the quote deadline as a countdown.

#### Scenario: Bitcoin for an nBTC invoice
- **WHEN** the payer picks Bitcoin BTC, enters a `bc1q…` refund address and a NEAR account, and requests a quote for a 0.01 nBTC invoice
- **THEN** the page shows the BTC amount to send, a Bitcoin deposit address and a QR code

#### Scenario: Missing refund address
- **WHEN** the payer requests a quote without the origin refund address or the NEAR account
- **THEN** the page asks for the missing field and requests no quote

### Requirement: Status timeline
After payment starts, the page SHALL show four steps and advance them from backend status: Deposit detected (cross-chain only), Delivered to contract (payment opened), Screening in enclave, then Released to merchant or Returned to you. The page SHALL say the payer may close it and that the payment continues.

#### Scenario: Released
- **WHEN** the invoice becomes Paid
- **THEN** the last step shows "Released to merchant"

#### Scenario: Returned
- **WHEN** the invoice becomes Returned
- **THEN** the last step shows "Returned to you" with the refund destination

#### Scenario: Screening evidence shown
- **WHEN** the invoice's screening outcome is `approved` or `rejected`
- **THEN** the Screening in enclave step shows the OutLayer request id, the short wasm hash and the run time, with links to the NEAR explorer transaction and to OutLayer executions

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
