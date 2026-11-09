## MODIFIED Requirements

### Requirement: Hook slide
Slide 1 SHALL state "Stripe for Web2. Gateflow for Web3." and that a business accepts crypto from any chain within a stated number of minutes. It SHALL claim "Compliance built in", "Self-custody" and "Any chain". It SHALL show payments from NEAR, Ethereum, Solana, Bitcoin and Zcash, in that order, going straight to "Your business wallet", with no chain named on the merchant side, and label the other 1Click chains as coming. The header SHALL carry "Launch console".

#### Scenario: Value at a glance
- **WHEN** slide 1 shows
- **THEN** "Gateflow for Web3", the minutes figure, "Compliance built in", "Self-custody" and "Any chain" are all visible without interaction

#### Scenario: Networks shown
- **WHEN** slide 1 shows
- **THEN** the networks read NEAR, Ethereum, Solana, Bitcoin, Zcash from top to bottom

### Requirement: How it works slide
Slide 3 SHALL show three steps:
1. The merchant signs in with their email; a passkey on the device secures the account.
2. The merchant shares an invoice link.
3. The buyer pays from NEAR, Ethereum, Solana, Bitcoin or Zcash, and the funds land in the merchant's own account.

#### Scenario: Three steps
- **WHEN** slide 3 shows
- **THEN** the three steps appear in order
