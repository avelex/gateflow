# merchant-accounts Specification

## Purpose

Gives each merchant a self-owned NEAR account and Gateflow gateway without exposing wallets, seed phrases, NEAR or gas, so the merchant signs every change with a passkey while the operator only provisions and pays.

## Requirements

### Requirement: Demo email session
The backend SHALL start a session for any well-formed email posted to the sign-in endpoint, without verifying it, and set an HttpOnly, SameSite=Lax cookie holding a random 256-bit token. The console SHALL show that sign-in is demo-only. Signing out SHALL delete the session.

#### Scenario: First sign-in
- **WHEN** `kaja@example.com` signs in for the first time
- **THEN** a session cookie is set and the console starts onboarding

#### Scenario: Malformed email
- **WHEN** the sign-in request carries `kaja@`
- **THEN** the backend answers 400 and sets no cookie

### Requirement: Session grants read access only
A session SHALL let the merchant read their own account, gateway, invoices, payments and preferences. A session alone SHALL NOT change anything on-chain; on-chain changes require a merchant-signed delegate action.

#### Scenario: Another merchant's data
- **WHEN** a session for `kaja@example.com` requests console data
- **THEN** only data of Kaja's gateway is returned

### Requirement: Passkey-derived merchant key
The console SHALL derive the merchant's ed25519 key from a passkey's WebAuthn PRF output with a fixed Gateflow salt, so the same passkey yields the same key on every device it syncs to. The key SHALL exist only in the browser and SHALL never be sent to the backend.

#### Scenario: Same key on a new device
- **WHEN** Kaja signs in on a second device with her synced passkey
- **THEN** the console derives the same public key that owns her account

### Requirement: Recovery-phrase fallback
When the authenticator does not support PRF, the console SHALL generate a random key, show its recovery phrase once with a confirmation step, and store the key non-extractable in the browser. Restoring on another device SHALL require the phrase.

#### Scenario: Authenticator without PRF
- **WHEN** passkey creation reports no PRF support
- **THEN** the console shows a recovery phrase and continues only after the merchant confirms they saved it

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

### Requirement: Gateway provisioned with fuel
After the account exists, the console SHALL have the merchant sign `create_gateway` with payout to their own account and `max_risk` 50. The console SHALL NOT offer another payout account. The backend SHALL relay it, record the gateway id, and fund the gateway's fuel to the configured target.

#### Scenario: Onboarding complete
- **WHEN** Kaja confirms the passkey prompt for gateway creation
- **THEN** a gateway owned by her account exists with fuel at the target, its `payout_to` is her account, and the console opens Home

#### Scenario: Payout field gone
- **WHEN** Kaja reaches the business-name step of onboarding
- **THEN** the form has no payout account field

### Requirement: One merchant per email
The backend SHALL map each email to at most one account and one gateway. A second onboarding attempt for an email that already has an account SHALL resume from the last unfinished step instead of creating another account.

#### Scenario: Interrupted onboarding
- **WHEN** Kaja closed the tab after account creation but before gateway creation
- **THEN** her next sign-in resumes at gateway creation
