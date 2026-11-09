## MODIFIED Requirements

### Requirement: Deferred screening checks the origin senders
The enclave SHALL determine the origin chain from 1Click's record of the quote, resolve the senders of every origin deposit transaction 1Click lists, and approve only if every sender passes that chain's screener against `max_risk`. Supported origins are the configured EVM chains, Solana, Bitcoin and Zcash. Any other origin, a missing transaction, an unresolvable sender or a failed lookup SHALL fail closed.

#### Scenario: Clean EVM payer
- **WHEN** the origin deposit transaction on Base is from an address with no GoPlus flags
- **THEN** screening returns true and the payment settles to the merchant

#### Scenario: Flagged EVM payer
- **WHEN** the origin deposit transaction is from a sanctioned address
- **THEN** screening returns false and the payment is refunded

#### Scenario: Unsupported origin
- **WHEN** the quote's origin chain is not EVM, Solana, Bitcoin or Zcash
- **THEN** screening returns false and the payment is refunded

#### Scenario: Several origin deposits
- **WHEN** 1Click lists two origin transactions and one comes from a flagged address
- **THEN** screening returns false and the payment is refunded

### Requirement: Enclave reads no secrets
The enclave SHALL read no secrets. The accepted caller, the EVM RPC endpoint of each supported EVM origin chain (`base`, `eth`, `arb`) and the Solana RPC endpoint SHALL be fixed when the enclave is built, with one build per network. The enclave SHALL query 1Click without an API key.

#### Scenario: No secrets stored
- **WHEN** the Gateflow contract requests a screening and the secrets profile it references holds no values
- **THEN** the screening runs and returns its normal verdict

#### Scenario: Secret cannot move the caller check
- **WHEN** the referenced secrets profile defines `GATEFLOW_CONTRACT` as another account
- **THEN** the enclave still accepts only the contract it was built for

## ADDED Requirements

### Requirement: Solana senders are every signer
For a Solana origin, the senders SHALL be every signer account of the deposit transaction, and each SHALL be checked against the OFAC sanctioned Solana address list. A listed signer SHALL count as risk 100 and any other as 0. A transaction the RPC does not return, or one with no signer, SHALL fail closed.

#### Scenario: Clean Solana payer
- **WHEN** no signer of the Solana USDC deposit is on the OFAC list
- **THEN** screening returns true and the USDC payment settles

#### Scenario: Sanctioned signer
- **WHEN** the fee payer of the Solana deposit is clean but its other signer is on the OFAC list
- **THEN** screening returns false and the payment is refunded

#### Scenario: Transaction not found
- **WHEN** the Solana RPC answers `getTransaction` with a null result for the deposit signature
- **THEN** screening returns false and the payment is refunded

#### Scenario: Solana RPC down
- **WHEN** the Solana RPC fails while screening a Solana-origin payment
- **THEN** the enclave outputs `false` and the payment is refunded
