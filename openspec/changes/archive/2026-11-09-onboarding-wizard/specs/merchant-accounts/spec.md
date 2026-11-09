# Spec Delta

## MODIFIED Requirements

### Requirement: Demo email session
The backend SHALL start a session for any well-formed email posted to the sign-in endpoint, without verifying it, and set an HttpOnly, SameSite=Lax cookie holding a random 256-bit token. The console SHALL show that sign-in is demo-only. Signing out SHALL delete the session. Every onboarding card SHALL show the session's email and a "Use another email" action that signs out and returns to sign-in.

#### Scenario: First sign-in
- **WHEN** `kaja@example.com` signs in for the first time
- **THEN** a session cookie is set and the console starts onboarding

#### Scenario: Malformed email
- **WHEN** the sign-in request carries `kaja@`
- **THEN** the backend answers 400 and sets no cookie

#### Scenario: Leave a stuck onboarding
- **WHEN** Kaja's onboarding stopped at the Gateway row and she presses "Use another email"
- **THEN** her session is deleted, the console shows sign-in, and signing in as `bob@example.com` starts Bob's onboarding

#### Scenario: Come back later
- **WHEN** Kaja signed out during onboarding and later signs in again as `kaja@example.com`
- **THEN** onboarding resumes from her last unfinished step

### Requirement: Recovery-phrase fallback
When the authenticator does not support PRF, the console SHALL generate a random key, show its recovery phrase once with a confirmation step, and store the key non-extractable in the browser. Restoring on another device SHALL require the phrase. The browser SHALL keep the key mode and the stored key separately for each email, so signing in as another merchant neither uses nor replaces them.

#### Scenario: Authenticator without PRF
- **WHEN** passkey creation reports no PRF support
- **THEN** the console shows a recovery phrase and continues only after the merchant confirms they saved it

#### Scenario: Two merchants on one browser
- **WHEN** Kaja stored a fallback key on this browser, and Bob then onboards on the same browser with a fallback key
- **THEN** Kaja signing in again still signs with her stored key, without her recovery phrase

#### Scenario: Other merchant's mode is not inherited
- **WHEN** Kaja uses PRF mode on this browser, and Bob signs in on it with an account but no key on this browser
- **THEN** the console asks Bob for his passkey or recovery phrase

#### Scenario: Key stored before this change
- **WHEN** a merchant's key mode and stored key were saved before keys were kept per email
- **THEN** the console still finds them for that merchant and signs without the recovery phrase

### Requirement: Gateway provisioned with fuel
After the account exists, the console SHALL have the merchant confirm `create_gateway` with payout to their own account and `max_risk` 50. The console SHALL NOT offer another payout account. In PRF mode, a key derived from the passkey earlier in the same page session SHALL sign without another prompt. Otherwise confirming SHALL trigger one passkey prompt. The backend SHALL relay it, record the gateway id, and fund the gateway's fuel to the configured target.

#### Scenario: Onboarding complete
- **WHEN** Kaja confirms the Gateway row
- **THEN** a gateway owned by her account exists with fuel at the target, its `payout_to` is her account, and the console opens Home

#### Scenario: Key held from the passkey row
- **WHEN** Kaja created her PRF passkey in this page session and presses Confirm on the Gateway row
- **THEN** `create_gateway` is signed with no passkey prompt

#### Scenario: Confirm after a reload
- **WHEN** Kaja reloads the page at the Gateway row and presses Confirm
- **THEN** one passkey prompt appears before `create_gateway` is signed

#### Scenario: Payout field gone
- **WHEN** Kaja reaches the business-name step of onboarding
- **THEN** the form has no payout account field

## ADDED Requirements

### Requirement: Onboarding advances one step per request
Each onboarding request SHALL complete at most one backend step (account creation, or token storage) and return the step it reached, with the account id. The token step SHALL register storage only on allowlisted tokens where the account has none. A failed step SHALL leave the recorded step unchanged.

#### Scenario: Account step
- **WHEN** Kaja's first onboarding request succeeds
- **THEN** the backend answers with step `tokens` and her account id, and has sent no storage registration

#### Scenario: Token step
- **WHEN** Kaja's onboarding request at step `tokens` succeeds
- **THEN** her account has storage on every allowlisted token and the backend answers with step `gateway`

#### Scenario: Retry after a partial token step
- **WHEN** registration on `zec.omft.near` failed after USDC and nBTC were registered, and Kaja retries
- **THEN** the backend registers only `zec.omft.near`

### Requirement: Onboarding progress
Onboarding SHALL show one card with the rows Passkey, NEAR account, Token storage, Gateway and Screening fuel. Each row SHALL be pending, running, waiting for the merchant, done or failed. A done row SHALL show its result, and a failed row SHALL show the backend's error and a retry that continues from that row.

#### Scenario: Progress while running
- **WHEN** Kaja's account exists and token storage is being registered
- **THEN** Passkey and NEAR account are done with her account id shown, Token storage is running, and Gateway and Screening fuel are pending

#### Scenario: Failed step
- **WHEN** token storage fails with `storage registration on zec.omft.near failed: ...`
- **THEN** the Token storage row is failed and shows that error, and Retry runs the token step again

#### Scenario: Gateway waits for the merchant
- **WHEN** token storage is done
- **THEN** the Gateway row waits for the merchant with an inline Confirm, and nothing is signed until she presses it

#### Scenario: Resume on reload
- **WHEN** Kaja reloads the page while her recorded step is `gateway`
- **THEN** the card shows the first three rows done and the Gateway row waiting for her

### Requirement: Fuel shown before the console opens
After the gateway is created, the Screening fuel row SHALL stay running until the gateway reports its fuel ready. Then the console SHALL open Home. If fuel is not ready, the row SHALL say it is still topping up and offer to check again.

#### Scenario: Fuel ready
- **WHEN** `create_gateway` succeeded and the gateway reports fuel ready
- **THEN** the Screening fuel row is done and the console opens Home

#### Scenario: Fuel top-up failed
- **WHEN** `create_gateway` succeeded but the operator's fund call failed
- **THEN** the Screening fuel row says the fuel is still topping up and offers Check again

### Requirement: Wrong passkey explained
When the passkey the merchant picks does not derive the key that owns their account, the console SHALL say so on the current row. It SHALL explain that the browser may list several passkeys for the email and that the newest one owns the account. It SHALL let the merchant try another passkey.

#### Scenario: Older passkey picked
- **WHEN** Kaja picks a passkey for `kaja@example.com` that does not own her account at the Gateway row
- **THEN** the row shows "This passkey does not own this account", the newest-passkey hint, and "Try another passkey"
