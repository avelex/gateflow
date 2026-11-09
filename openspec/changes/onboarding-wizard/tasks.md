# Tasks

**Goal:** one onboarding card with a live five-row timeline, a way out on every card, key state kept per email, and an inline gateway confirm that reuses the held PRF key.

**Spec:** `specs/merchant-accounts/spec.md`. **Design:** `design.md` (decisions 1–7). **Visual reference:** option C, artboards C1–C3, on https://claude.ai/artifact/9bBwhYDm1SE4fM4myVoGCn.

**Global constraints:**
- `relay/` uses Node built-ins only. Add no npm dependency in `relay/` or `web/`.
- Tests come first in every group.
- Before each commit, run the module's suite:
  - `cd relay && npm test`
  - `cd web && npx vitest run && npx tsc --noEmit`
- Commits are short Conventional Commits, on a branch off `main`.
- Row labels, exactly: `Passkey`, `NEAR account`, `Token storage`, `Gateway`, `Screening fuel`.
- Copy, exactly:
  - `Use another email`
  - `Signed in as <email>`
  - `This passkey does not own this account`
  - `Try another passkey`
  - `Check again`

**Review focus.** These are untested-elsewhere cases; each one gets a pinning test in the task named.
1. Two tabs onboarding the same email at once must not create two accounts. The existing `onboard_concurrent_single_account` test must still pass with one step per call (1.1).
2. A retry after a `502` at step `account` must reuse the held key, not create a new passkey (4.2).
3. Signing out must drop the held key, so the next email cannot sign with the previous merchant's key (4.3).
4. A legacy entry must be claimed by only one email (3.2).
5. A fuel check that throws must leave the row on `Check again`, never stuck on running (4.4).

## 1. Relay: one onboarding step per request

- [x] 1.1 Update the shared fakes and the existing onboarding tests in `relay/src/console.test.ts`.
  - `withTokens` also fakes `storage_balance_of`: move the `withStorage` logic into it, with `already` defaulting to `[]`.
  - `onboarded()` calls `POST /console/onboard` until `step === "gateway"`, at most 3 calls, and returns the last reply.
  - `onboard_twice_resumes` expects `step === "tokens"` on the second call and `"gateway"` on the third.
  - `onboard_concurrent_single_account` still asserts that only one account is created.
  - Verify: `cd relay && npm test` fails only on the new step-count assertions.
- [x] 1.2 Add failing tests:
  - `onboard_account_step_only`: the first call answers `{ step: "tokens", accountId }`, and `deps.near.sent` holds one tx (createAccount) and no `storage_deposit`.
  - `onboard_tokens_step`: the next call answers `step: "gateway"`, with one `storage_deposit` per allowlisted token.
  - `onboard_tokens_skips_registered`: with `already: ["wrap.testnet:<accountId>"]`, a `storage_deposit` goes only to `usdc.testnet`.
  - `onboard_tokens_failure_keeps_step`: a failed `storage_deposit` answers `502`, and the step stays `tokens`.
  - Verify: these 4 fail.
- [x] 1.3 In `relay/src/console.ts`, change `onboard` so that each `if (m.step === …)` block returns `ok({ step: m.step, accountId: m.account_id })` right after its `upsertMerchant`. The `tokens` block calls `ensureRegistered(deps, m.account_id, token)` for each token, in place of the inline `storage_deposit` loop. Verify: `cd relay && npm test` passes. Commit `feat(relay): onboard one step per request`.

## 2. Key state per email

- [x] 2.1 Add failing tests in `web/src/near/key.test.ts`, using `MemStorage`:
  - `mode_scoped_by_owner`: `setKeyOwner("a@x")`, `rememberPasskeyMode()`, then `setKeyOwner("b@x")` gives `keyMode() === null`; switching back to `a@x` gives `"prf"`.
  - `legacy_claimed_once`: with `gateflow:keyMode = "stored"` and no marker, owner `a@x` gets `"stored"`, and `gateflow:legacyClaimedBy === "a@x"`. Owner `b@x` then gets `null`. The legacy key itself is still present.
  - `store_key_name`: `storeKeyName("a@x") === "merchant:a@x"`. For the claimer, `storeKeyName` falls back to `"merchant"` while no `merchant:<email>` record exists; that fallback is covered by the design and not unit-tested, since there is no IndexedDB fake.
  - `not_owner_typed`: `assertOwner(key, other)` throws an instance of `NotOwner`, with the message unchanged.
  - Verify: these fail.
- [x] 2.2 In `web/src/near/key.ts`:
  - Add `export function setKeyOwner(email: string | null): void`.
  - Add `export class NotOwner extends Error`, thrown by `assertOwner`.
  - Add `export const storeKeyName = (email: string) => …`.
  - `keyMode()` and `setMode()` use `gateflow:keyMode:<owner>`, and claim the legacy entries as design decision 3 describes.
  - `store()` and `loadStoredKey()` use `merchant:<owner>`. `loadStoredKey` falls back to `"merchant"` only when this owner is `legacyClaimedBy`.
  - Existing tests that set `gateflow:keyMode` call `setKeyOwner` first.

  Verify: `cd web && npx vitest run && npx tsc --noEmit` pass.
- [x] 2.3 In `web/src/console/Console.tsx`, call `setKeyOwner(me.email)` after `/console/me` loads, and `setKeyOwner(null)` on sign-out. The callers in `cards.tsx`, `Developers.tsx` and `Invoices.tsx` stay unchanged. Verify: `npx tsc --noEmit`. Commit `feat(web): keep merchant key per email`.

## 3. Onboarding row model

- [ ] 3.1 Add failing tests in `web/src/console/logic.test.ts` for `onboardingRows(s: OnboardingState): Row[]`.
  - Types:
    - `OnboardingState = { step: Step; running?: RowId; failed?: { row: RowId; error: string; notOwner: boolean }; fuel?: "checking" | "ready" | "low" }`
    - `RowId = "passkey" | "account" | "tokens" | "gateway" | "fuel"`
    - `Row = { id: RowId; label: string; state: "pending" | "running" | "waiting" | "done" | "failed"; detail?: string }`
  - Cases:
    - `rows_running_tokens`: `{ step: "tokens", running: "tokens" }` gives passkey and account `done`, tokens `running`, gateway and fuel `pending`.
    - `rows_gateway_waits`: `{ step: "gateway" }` gives the first three `done` and gateway `waiting`.
    - `rows_failed_row`: `failed: { row: "tokens", error: "storage registration on zec.omft.near failed: x", notOwner: false }` gives tokens `failed` with that exact detail.
    - `rows_not_owner_hint`: with `notOwner: true` on gateway, the detail includes `This passkey does not own this account`.
    - `rows_fuel_low`: `{ step: "done", fuel: "low" }` gives fuel `failed`, detail `Still topping up`.
    - `rows_resume_reload`: `{ step: "gateway" }` with no running row gives gateway `waiting`, which is the same as `rows_gateway_waits` (spec: Resume on reload).
  - Replace the `onboardingScreen` tests: `onboardingScreen(step, mode)` returns `"timeline"` for `account`; `"resume-key"` when the step is past `account` and the mode is null; `"timeline"` otherwise; `"done"` for `done`.
  - Verify: these fail.
- [ ] 3.2 Implement `onboardingRows`, the types above and the reduced `onboardingScreen` in `web/src/console/logic.ts`. The labels are the five exact strings from the global constraints. Verify: `cd web && npx vitest run` passes. Commit `feat(web): onboarding row model`.

## 4. Onboarding timeline card

- [ ] 4.1 Rewrite `web/src/console/Onboarding.tsx` as one timeline card, following design decisions 2, 4 and 5 and artboards C1–C3.
  - The business-name input and the `Create passkey and start` button show while `step === "account"`.
  - Rows render with the `Timeline` row markup from `web/src/checkout/Timeline.tsx`. Extract the row markup if reuse needs it.
  - Each `onboard` call updates `running` and the row's elapsed time.
  - The Gateway row shows an inline `Confirm` while `waiting`.
  - The recovery-phrase card and the resume-key card stay, each with the footer from 4.3.
  - Verify: `npx tsc --noEmit` passes; local relay check in 5.1.
- [ ] 4.2 Hold the key. A `useRef<MerchantKey>` is set by `createPasskeyKey`, `createFallbackKey` or `acquireKey`. Retry and Confirm use the ref when it is set, and call `acquireKey(keyMode())` otherwise.
  - Extract `keyFor(held: MerchantKey | undefined, acquire: () => Promise<MerchantKey>): Promise<MerchantKey>` into `logic.ts`.
  - Test `key_for_reuses_held`: with a held key, `acquire` is never called.
  - Test `key_for_acquires_without_held`: without one, `acquire` is called once.
  - Verify: `npx vitest run`.
- [ ] 4.3 Add the footer `Signed in as <email>` · `Use another email` to every onboarding card. Pressing `Use another email`:
  - calls `api("DELETE", "/console/session")`
  - clears the held-key ref
  - calls `setKeyOwner(null)`
  - calls a new `onSignOut` prop, which `Console.tsx` wires to `setState({ kind: "signin" })`

  Verify: `npx tsc --noEmit`, plus local relay check 5.1, step 4.
- [ ] 4.4 Run the gateway and fuel sequence. After `signAndRelay(create_gateway)` succeeds:
  - Gateway is `done`, and fuel is `checking` while `GET /console/gateway` runs.
  - `fuelReady: true` gives `ready`, then `onChange()`.
  - `false` or a thrown error gives `low` with a `Check again` button.

  Extract `fuelState(r: { fuelReady: boolean } | Error): "ready" | "low"` into `logic.ts`, with tests `fuel_ready`, `fuel_low` and `fuel_error_is_low`. Verify: `npx vitest run` passes. Commit `feat(web): onboarding timeline with inline gateway confirm`.

## 5. Integration check

- [ ] 5.1 Run a local relay against testnet (`relay/README.md` § Run). Never use the mainnet `relay/.env` while the Fly app is up. Then check these, without code changes:
  1. A new email shows the rows ticking in order, with a single passkey create (plus the PRF unlock prompt if the browser needs it), and Gateway confirms with no prompt.
  2. A reload at the Gateway row makes Confirm prompt once.
  3. Picking an older passkey shows the `NotOwner` hint.
  4. `Use another email` returns to sign-in, a second email onboards, and the first email signs in again and resumes.
  5. Every check passes in both the PRF mode and the fallback mode.

  Verify: all five checks pass. Note any failure in this task.
- [ ] 5.2 Run all suites: `cd relay && npm test`, `cd web && npx vitest run && npx tsc --noEmit`, `cd contract && cargo test`. Verify: all pass.

## Workflow follow-up

- Relay and web deploy (`fly deploy`) only after the owner approves.
- Update README Status only if the onboarding claims in it change.
- Archive with `/opsx:archive` after review.
