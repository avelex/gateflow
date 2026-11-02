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
