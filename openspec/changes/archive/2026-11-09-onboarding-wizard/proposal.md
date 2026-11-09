# Proposal

## Why

Onboarding can leave a merchant stuck with no way out:

- No onboarding card offers sign-out, and sessions never expire, so after a failed step the browser stays on that email.
- One disabled button covers up to two passkey prompts, an account creation and three token registrations. The merchant cannot tell which step failed.
- Retries at the first step create extra passkeys under the same email. The gateway step then fails with `This passkey does not own this account`, and nothing explains why.

## What Changes

- **One live timeline.** One onboarding card shows five rows: Passkey, NEAR account, Token storage, Gateway, Screening fuel. Each row is pending, running, done or failed, with its elapsed time or error. Retry continues from the step the backend recorded. Layout: option C of the design canvas (https://claude.ai/artifact/9bBwhYDm1SE4fM4myVoGCn).
- **A way out of every onboarding card.** Each card shows "Signed in as <email>" and a "Use another email" action. It deletes the session and returns to sign-in.
- **Key state per email.** The device's key mode and fallback key are stored per email, not per browser. A second merchant on the same browser no longer inherits or overwrites the first one's key. The old unscoped entries are read once as a fallback.
- **One step per request.** `POST /console/onboard` advances one step per call (`account`, then `tokens`) and returns the new step. The token step skips tokens already registered. **BREAKING** (internal API): one call no longer reaches `gateway`. The console is the only client.
- **Inline gateway confirm.** The timeline pauses at the Gateway row with an inline Confirm button. In PRF mode the click signs `create_gateway` with the key derived at the Passkey row, with no new prompt. After a reload, or in fallback mode, the click asks for the passkey.
- **Fuel row from real state.** The Screening fuel row reads `GET /console/gateway` and ticks when `fuelReady` is true.
- **Wrong-passkey guidance.** When the chosen passkey does not own the account, the row tells the merchant to pick the newest passkey for this email.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `merchant-accounts`:
  - sign-out during onboarding
  - fallback key stored per email
  - one onboarding step per request, with step-level progress
  - gateway confirm can reuse the held key
  - fuel state shown before the console opens

## Impact

- `web/src/console/Onboarding.tsx`: rewritten as the timeline card, in the checkout `Timeline` row style.
- `web/src/console/logic.ts`: onboarding row model.
- `web/src/console/Console.tsx`: sign-out from onboarding.
- `web/src/near/key.ts`: mode and stored key keyed by email, with a legacy fallback.
- `relay/src/console.ts`: `onboard` runs one step per call. The token step uses `ensureRegistered`.
- Tests:
  - `relay/src/console.test.ts`: the `onboarded` helper loops through the steps.
  - `web/src/console/logic.test.ts`
  - `web/src/near/key.test.ts`
- No contract or enclave change. Shipping needs a relay and web deploy, which the owner approves.
