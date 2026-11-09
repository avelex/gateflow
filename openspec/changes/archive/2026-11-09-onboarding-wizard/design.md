# Design

## Context

See proposal.md (Why). Current flow:

- `Console.tsx` shows `SignIn` only on a 401. `Onboarding.tsx` picks a card from `onboardingScreen(me.step, keyMode())`.
- `POST /console/onboard` (`relay/src/console.ts`) runs `account` and then `tokens` in one request, under `withLock(email)`, and records each step in the `merchants` row.
- The gateway card calls `signAndRelay(acquireKey(keyMode()), create_gateway)`. On success the relay sets `step = "done"` and calls `fund()` without waiting for the client. `GET /console/gateway` (`readGateway`) tops up low fuel and returns `fuelReady`.
- `near/key.ts` keeps one browser-wide mode (`localStorage["gateflow:keyMode"]`) and one fallback key (IndexedDB `keys/"merchant"`).
  - `keyMode()` and `acquireKey()` are also called from `cards.tsx`, `Developers.tsx` and `Invoices.tsx`.
- Design reference: option C on https://claude.ai/artifact/9bBwhYDm1SE4fM4myVoGCn (C1 start, C2 waiting at gateway, C3 wrong passkey).

## Goals / Non-Goals

**Goals:**
- Every row maps to one real backend call, or one client step. No progress is invented.
- The existing step machine (`account`, `tokens`, `gateway`, `done`) and the DB schema stay unchanged.
- Signing call sites outside onboarding keep their current shape.

**Non-Goals:**
- Per-token live progress inside the Token storage row. The row shows the symbols when it is done, and the token named in the error when it fails.
- Detecting orphan gateways (a tx that landed but was lost by the relay). The contract has no by-owner view, the case is rare, and its only cost is an unused gateway.
- Session expiry. Not needed now that every card has a way out.
- Removing old orphan passkeys from the user's authenticator.

## Decisions

### 1. One step per request, the client drives the loop
`onboard` returns after the first step it completes. The client calls it again while the step is `account` or `tokens`, and updates the row after each reply. A failure leaves the recorded step unchanged, so Retry is the same call again.

Alternatives considered:
- Server-sent progress (SSE): a new transport for a 20-second flow.
- Timed client-side loaders: they would point at the wrong row on failure.

The token step calls the existing `ensureRegistered`, which takes a per-token lock and skips accounts that already have storage. Retries then register only what is missing.

**Compatibility:**
- The old web against the new relay stops after one step. Its next click continues the flow.
- The new web against the old relay gets `gateway` on the first call. The loop ends.

So the relay and the web can deploy in either order.

### 2. A held key for the page session
`Onboarding` keeps the `MerchantKey` from the Passkey row in a ref.

- **Retry of any row** reuses the held key. This removes the extra passkeys that retries at step `account` create today.
- **Gateway Confirm** signs with the held key. Pressing Confirm is the merchant's consent.
- **No held key** (after a reload, in stored mode, or after a sign-out): `acquireKey`, which shows one prompt.

Stored-mode keys still prompt on every `sign()` (unchanged). The ref dies with the page; nothing new is persisted.

Alternative considered: prompt on Confirm every time. Rejected by the owner: one prompt more, and nothing gained in safety.

### 3. Key state per email, with a module-level owner
`key.ts` gains `setKeyOwner(email)`, which `Console` calls once `/console/me` loads. After that:
- `keyMode()` and `setMode` use `gateflow:keyMode:<email>`.
- `store` and `loadStoredKey` use the IndexedDB key `merchant:<email>`.

The call sites in `cards.tsx`, `Developers.tsx` and `Invoices.tsx` stay unchanged.

Legacy entries:
- When the email has no entry and `gateflow:legacyClaimedBy` is unset, the email claims the old `gateflow:keyMode` and `"merchant"` entries. It copies them to its own keys and sets the marker.
- The old entries are kept, so a rollback to the old web still finds them.

Alternative considered: key the stored key by account public key. That needs the public key before every load, and it still leaves the mode without an owner.

### 4. Row model as a pure function
`logic.ts` gains `onboardingRows(state)`. Its input:
- the recorded step
- the running row
- the last error and its row
- whether a key is held
- the fuel state

It returns the five rows, each with its state and detail. `Onboarding.tsx` only renders the rows and wires up the buttons. It reuses the checkout `Timeline` row markup (square markers, 2 px connector line). `onboardingScreen` shrinks to three outcomes: `resume-key`, `timeline` and `done`. The recovery-phrase card stays as it is and gains the email footer.

### 5. Fuel row from `GET /console/gateway`
After the relay reply, the client marks the Gateway row done from `{ value: id }` and calls `GET /console/gateway`.
- `fuelReady: true`: the row ticks, then `onChange()` opens Home.
- `fuelReady: false` or an error: the row shows "Still topping up" and a Check again button, which calls the same endpoint (it also tops up).

`onChange()` is held back until this row settles. Otherwise `step = "done"` would swap the card for the console too early.

### 6. Typed owner error
`assertOwner` throws `NotOwner` (it extends `Error` and keeps the same message). The row shows the newest-passkey hint when it sees `instanceof NotOwner`, without matching on the message text.

### 7. "Use another email"
A footer on every onboarding card calls `DELETE /console/session`, clears the held key, and sets the Console state to `signin`. The same pattern already exists in `Layout`.

## Risks / Trade-offs

- [A different email claims the legacy entries on a shared browser] The first email to load claims them. A wrong claim is visible: the merchant gets the passkey prompt and then the wrong-passkey hint, and can recover with the recovery phrase. Only browsers used before this change are affected.
- [The held key signs without a biometric check] The key only signs after an explicit Confirm click in the same page session, and the relay still allows only `create_gateway` with payout to the merchant's own account. If the session is lost, the key is lost with it.
- [More requests per onboarding (two calls instead of one)] Each call is shorter, and no single request runs for the whole flow anymore.
- [The fuel row waits on an operator top-up] It never blocks: Check again works, and the console's own top-up keeps running after Home opens.

## Migration Plan

1. No DB or contract migration.
2. Deploy relay and web together with `fly deploy` (owner approval). Decision 1 makes either order safe.
3. Rollback: redeploy the previous image. Legacy key entries are untouched, so the old web keeps working.
