## MODIFIED Requirements

### Requirement: Pay from another chain
The page SHALL let the payer pick an origin chain from the relay's same-asset quotable assets for the invoice, shown as one card per chain with its chain icon, enter a refund address on that chain (used if the swap fails) and a NEAR account (used if screening returns the payment), and request a quote. It SHALL then show the exact amount to send with a copy action, the deposit address with a QR code and copy action, an optional memo, and the quote deadline as a countdown.

#### Scenario: Bitcoin for an nBTC invoice
- **WHEN** the payer picks Bitcoin, enters a `bc1q…` refund address and a NEAR account, and requests a quote for an invoice of 0.01 `nbtc.bridge.near`, shown as 0.01 BTC
- **THEN** the page shows the BTC amount to send, a Bitcoin deposit address and a QR code

#### Scenario: Missing refund address
- **WHEN** the payer requests a quote without the origin refund address or the NEAR account
- **THEN** the page asks for the missing field and requests no quote

#### Scenario: Chains of a USDC invoice
- **WHEN** the payer opens the cross-chain option of a 1 USDC invoice
- **THEN** the page shows one card each for Base, Arbitrum and Ethereum, labeled with the chain name and the token symbol, and no other token

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

## ADDED Requirements

### Requirement: Quote fee shown
With a quote shown, the page SHALL state how much of the amount to send exceeds the invoice amount, as the 1Click fee and slippage buffer, in the origin token.

#### Scenario: USDC from Base
- **WHEN** a 1 USDC invoice is quoted from Base with `amountIn` 1.010225 USDC
- **THEN** the page says 0.010225 USDC of it covers the 1Click fee and slippage buffer
