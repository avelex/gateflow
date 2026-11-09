## MODIFIED Requirements

### Requirement: Accepted tokens and chains
Settings SHALL list the allowlisted tokens with a toggle per token and the payer origins (NEAR, the configured EVM chains, Solana, Bitcoin, Zcash) read-only. Toggles SHALL be stored as a backend preference and limit the tokens offered when creating invoices; they SHALL NOT change the contract.

#### Scenario: Token switched off
- **WHEN** Kaja switches ZEC off
- **THEN** the invoice form no longer offers ZEC

#### Scenario: Solana listed
- **WHEN** Kaja opens Settings and 1Click lists USDC on Solana
- **THEN** Solana appears among the payer origins
