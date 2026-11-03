# Spec Delta

## MODIFIED Requirements

### Requirement: Gateway provisioned with fuel
After the account exists, the console SHALL have the merchant sign `create_gateway` with payout to their own account and `max_risk` 50. The console SHALL NOT offer another payout account. The backend SHALL relay it, record the gateway id, and fund the gateway's fuel to the configured target.

#### Scenario: Onboarding complete
- **WHEN** Kaja confirms the passkey prompt for gateway creation
- **THEN** a gateway owned by her account exists with fuel at the target, its `payout_to` is her account, and the console opens Home

#### Scenario: Payout field gone
- **WHEN** Kaja reaches the business-name step of onboarding
- **THEN** the form has no payout account field

## ADDED Requirements

### Requirement: Operator provisions a random-named account
At onboarding the backend SHALL create the NEAR account `<label>.<merchant parent>`, where `<label>` is 8 random characters from `a-z2-7` and the merchant parent is the configured account (`merchant.gateflow.near` on mainnet), with the merchant's public key as its only access key. The operator SHALL add no key. The account id SHALL NOT contain the business name. The backend SHALL register storage for that account on every allowlisted token and record the email-to-account mapping.

#### Scenario: Account created
- **WHEN** Kaja finishes onboarding with business name "Kaja Coffee"
- **THEN** an account `<label>.merchant.gateflow.near` exists, its label has 8 characters from `a-z2-7`, its only access key is Kaja's public key, and it can receive every allowlisted token

#### Scenario: Business name stays off chain
- **WHEN** Kaja finishes onboarding with business name "Kaja Coffee"
- **THEN** her account id does not contain "kaja" or "coffee", and the console still shows "Kaja Coffee"

#### Scenario: Label taken
- **WHEN** the random account id already exists
- **THEN** the backend draws another label and creates that account instead

### Requirement: Payout accounts follow the token allowlist
The backend SHALL keep the payout account of every merchant's gateway registered for storage on every allowlisted token, including tokens added after the merchant onboarded. It SHALL check and register them all when it starts. Before serving a checkout, it SHALL check the payout account of the invoice's gateway on the invoice's token.

#### Scenario: Token added after onboarding
- **WHEN** the operator allowlists `zec.omft.near` after Kaja onboarded and the backend restarts
- **THEN** her gateway's payout account is registered on `zec.omft.near` before any payment to her can settle

#### Scenario: Checkout without a restart
- **WHEN** a payer opens the checkout for Kaja's ZEC invoice and her payout account has no storage on `zec.omft.near`
- **THEN** the backend registers it before returning the checkout

#### Scenario: Payout changed by the owner
- **WHEN** Kaja's gateway owner called `set_payout` with `kaja-shop.near` and a payer opens a checkout for her USDC invoice
- **THEN** the backend makes sure `kaja-shop.near` is registered on USDC

#### Scenario: Already registered
- **WHEN** the backend starts and every payout account is registered on every allowlisted token
- **THEN** it sends no registration transaction

## REMOVED Requirements

### Requirement: Operator provisions a self-owned account
**Reason**: Merchant accounts were named `<slug>.<operator account>`, which put the business name on chain. They are now `<label>.<merchant parent>` with a random label.
**Migration**: Replaced by "Operator provisions a random-named account". Existing `<slug>.relay.greatbank5653.near` accounts stay with their owners. The new deployment does not use them.

### Requirement: Payout account can receive every token
**Reason**: Custom payout accounts are removed. A gateway always pays out to the merchant's own account, which the backend creates and registers on every allowlisted token.
**Migration**: None needed. The mainnet deployment that used it is retired, and the backend no longer accepts `payoutTo` at onboarding.
