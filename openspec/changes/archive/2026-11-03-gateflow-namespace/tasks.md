# Gateflow Namespace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. OpenSpec tracks only the `- [ ] N.M` lines; the numbered steps under each task are its TDD cycle and are not tracked separately.

**Goal:** Redeploy Gateflow under `gateflow.near` so that merchants get random-named accounts under `merchant.gateflow.near`, every gateway pays out to an account registered on every allowlisted token, and the contract gains an owner-only `set_payout`.

**Architecture:**
- The contract adds `set_payout`; `retry` already reads the current payout.
- The relay creates merchant accounts with a second signer (`MERCHANT_PARENT`, same key), sponsors `create_gateway` only for payouts to the sender, and registers payout accounts on tokens at startup and before each checkout.
- The web drops the payout field.
- Operations create the accounts, deploy, then retire `gateflow.greatbank5653.near`.

**Tech Stack:** Rust near-sdk 5 (`contract/`, Rust 1.86.0), Node 26 built-ins with `node --test` (`relay/`), React with Vitest (`web/`), near-cli-rs 0.30 and outlayer CLI 0.2 (operations).

**Spec:**
- `openspec/changes/gateflow-namespace/specs/{merchant-accounts,merchant-gateways,payment-clearing,sponsored-transactions}/spec.md`
- `openspec/changes/gateflow-namespace/design.md`

## Global Constraints

- **Label alphabet:** `abcdefghijklmnopqrstuvwxyz234567`, 8 characters, each drawn with `crypto.randomInt(32)`. Account id: `<label>.<cfg.merchantParent>`. At most 20 tries, then 409 `"no free account name, try again"`.
- **Config:** `MERCHANT_PARENT` defaults to `RELAY_ACCOUNT_ID`, with the same `RELAY_PRIVATE_KEY`.
- **Mainnet accounts:** contract `gateflow.near`; operator, enclave owner and `secrets_owner` `ops.gateflow.near`; relay `relay.gateflow.near`; merchant parent `merchant.gateflow.near`; enclave project `ops.gateflow.near/gateflow`.
- **Init:** `new(operator: ops.gateflow.near, relay: relay.gateflow.near, intents: intents.near, enclave: {outlayer: outlayer.near, project: ops.gateflow.near/gateflow, secrets_owner: ops.gateflow.near}, execution_deposit: "10000000000000000000000")`.
- **Tokens:** USDC `17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1`, `nbtc.bridge.near`, `zec.omft.near`.
- **Registration:** `storage_deposit {account_id, registration_only: true}`, deposit `storage_balance_bounds.min`, 30 Tgas. "Registered" means `storage_balance_of` is not null.
- **Contract panics:** `"not the gateway owner"`, `"unknown gateway"` (the existing helpers).
- **Relay 403 copy:** `"gateway must pay out to your account"`.
- **Never delete** the full-access key of `gateflow.near` in this change. The owner decides that in `mainnet-launch` 1.1.
- **Commits:** short conventional style, one per task.

## Review Focus

- **`create_gateway` delegate whose args are not JSON or lack `payout_to`:** 403, never a crash. Test `create_gateway_bad_args_refused` (2.1).
- **Delegate with two `create_gateway` actions where only the second pays elsewhere:** 403. Test `create_gateway_second_action_refused` (2.1).
- **Two checkouts opened at the same moment for an unregistered payout:** one `storage_deposit`. Test `ensure_registered_concurrent_once` (2.3).
- **Registration fails at checkout:** 502 and no checkout data, because a payment could not settle. Test `checkout_registration_failure_502` (2.3).
- **One token's registration fails during the startup sync:** the other merchants and tokens are still registered, and the relay keeps running. Test `sync_continues_after_failure` (2.3).

---

## 1. Contract

- [x] 1.1 Add owner-only `set_payout`. Verify that `cd contract && cargo test` passes `set_payout_by_owner`, `non_owner_cannot_set_payout`, `set_payout_unknown_gateway` and `retry_settle_goes_to_new_payout`, plus all existing tests, and that `cargo near build non-reproducible-wasm` succeeds.
  1. In `contract/src/gateways.rs` tests, add:
     - `set_payout_by_owner`: `with_gateway()`, `c.set_payout(0, accounts(4))`, then `get_gateway(0).payout_to == accounts(4)`.
     - `#[should_panic(expected = "not the gateway owner")] non_owner_cannot_set_payout`, using `as_caller(&accounts(2))`.
     - `#[should_panic(expected = "unknown gateway")] set_payout_unknown_gateway`, calling `c.set_payout(42, …)`.
  2. In `contract/src/closing.rs` tests, add `retry_settle_goes_to_new_payout`:
     - set up the state from `failed_settle_marks_settle_failed`;
     - `as_caller(&merchant())` and `c.set_payout(0, accounts(4))`;
     - `retry(0)`;
     - assert `ft_transfer() == (usdc(), accounts(4).to_string(), TEN_USDC.to_string())` and the status is `Settled`.
  3. Run them and see them fail to compile.
  4. Implement `pub fn set_payout(&mut self, gateway: GatewayId, payout_to: AccountId)` in the `#[near] impl` of `gateways.rs`, through `owned_gateway_mut`.
  5. Update the doc comment on `retry` in `closing.rs`: "a settle goes to the gateway's current payout". Run the tests and the build.
  6. Commit `feat(contract): owner-only set_payout`.

## 2. Relay

- [x] 2.1 Remove custom payouts, and sponsor `create_gateway` only for payouts to the sender. Verify that `cd relay && node --test "src/*.test.ts"` passes all tests, including:
  - in `delegate.test.ts`: `create_gateway_own_payout_allowed`, `create_gateway_other_payout_refused`, `create_gateway_bad_args_refused`, `create_gateway_second_action_refused`, `set_payout_refused`;
  - in `console.test.ts`: `onboard_ignores_payout_to`.
  1. In `delegate.test.ts`, add the 5 tests with `check([...])`:
     - `payout_to: "kaja.op.testnet"` is `undefined`;
     - `payout_to: "kaja-shop.near"` gives `"gateway must pay out to your account"`;
     - args that are not JSON, and args without `payout_to`, give that same message;
     - a valid `create_gateway` followed by one with another payout gives that same message;
     - a `set_payout` method gives `"method set_payout is not sponsored"`.
  2. In `console.test.ts`:
     - delete the `onboard_payout_*` tests, `onboardWithPayout` and `registered`;
     - add `onboard_ignores_payout_to`: posting `payoutTo: "shop.testnet"` creates no account other than the merchant's, registers only the merchant account, and the response has no `payoutTo`.
  3. In `shell.test.ts`, delete `db_adds_payout_column_to_old_db`, and remove `payout_to` from `db_merchant_roundtrip`. Run the tests and see them fail.
  4. In `delegate.ts` `refusal()`: for `method === "create_gateway"`, parse `a.args` as JSON inside a try, and refuse unless `payout_to === d.senderId`.
  5. Revert the payout parts of `33f6253`:
     - in `console.ts`: `rootAccount`, `creatable`, the `payoutTo` validation and assignment, the payout creation block and second registration, and `payoutTo` in the onboard and `me` responses;
     - in `db.ts`: the `payout_to` field, column and migration.

     Run the tests.
  6. Commit `refactor(relay): payout is the merchant account only`.
- [x] 2.2 Create random-named merchant accounts under `MERCHANT_PARENT`. Verify that `node --test "src/*.test.ts"` passes `random_label_alphabet`, `onboard_account_under_parent`, `onboard_label_taken_draws_again` and `onboard_creates_with_creator`, and that the existing onboarding tests pass with labels instead of slugs.
  1. In `console.test.ts`:
     - replace the `slug_*` tests and `slug_suffix_when_taken` with these:
       - `random_label_alphabet`: 200 calls to `randomLabel()` each match `/^[a-z2-7]{8}$/`.
       - `onboard_account_under_parent`: `fakeDeps({ merchantParent: "merchant.op.testnet" })`. The created id matches `/^[a-z2-7]{8}\.merchant\.op\.testnet$/` and does not contain `kaja`.
       - `onboard_label_taken_draws_again`: `accountExists` returns true on the first call only. The created id differs from the first id checked.
       - `onboard_creates_with_creator`: `deps.creator = fakeNear()`. The `createAccount` transaction is in `deps.creator.sent`, and the token registrations are in `deps.near.sent`.
     - change the literal `kaja-coffee.op.testnet` assertions in `onboard_account_tx_actions` and `onboard_registers_every_token` to read the id from the response.
  2. Run the tests and see them fail.
  3. Implement:
     - `export function randomLabel(): string` in `console.ts`;
     - `freeAccountId(deps)` builds `` `${randomLabel()}.${deps.cfg.merchantParent}` `` and sends the `createAccount` transaction through `deps.creator ?? deps.near`;
     - delete `slug`.
  4. Wire the config:
     - `Config.merchantParent: string`, from `env.MERCHANT_PARENT || env.RELAY_ACCOUNT_ID || ""` in `types.ts`;
     - `Deps.creator?: Near`;
     - in `main.ts`, `creator: rpcNear({ rpcUrl, accountId: cfg.merchantParent, secret: cfg.secret })`.
  5. Add `MERCHANT_PARENT` to the env table in `README.md`, and change the `RELAY_ACCOUNT_ID` row and "The merchant's side" step 3 to `<label>.<MERCHANT_PARENT>`. Run the tests.
  6. Commit `feat(relay): random merchant accounts under MERCHANT_PARENT`.
- [x] 2.3 Keep payout accounts registered on every allowlisted token. Verify that `node --test "src/*.test.ts"` passes:
  - `ensure_registered_skips_registered`, `ensure_registered_registers_missing`, `ensure_registered_concurrent_once`;
  - `sync_registers_all_payouts`, `sync_continues_after_failure`;
  - `checkout_registers_payout`, `checkout_registration_failure_502`;
  - all existing `checkout_*` tests.
  1. In `console.test.ts`, add the `ensure_registered_*` and `sync_*` tests:
     - fake views `<token>.storage_balance_of` as `(a) => null | {total: "1250000000000000000000", available: "0"}`, and `gateflow.testnet.get_gateway`;
     - `sync_*` seeds 2 merchants with gateways 0 and 1 and 2 tokens;
     - `sync_continues_after_failure` fails the first send with `{hash: "x", error: "boom"}` and expects 3 later registrations;
     - `concurrent_once` runs two `ensureRegistered` calls with `Promise.all` and expects one send.
  2. In `checkout.test.ts`:
     - add `get_gateway` and `storage_balance_of` fakes to the shared setup around line 38;
     - add `checkout_registers_payout`: payout unregistered on the invoice token, so one `storage_deposit` and 200;
     - add `checkout_registration_failure_502`.

     Run the tests and see them fail.
  3. Implement in `console.ts`:
     - `export async function ensureRegistered(deps: Deps, account: string, token: string): Promise<boolean>`. It returns true when it sent a registration, throws `HttpError(502)` on a failed send, and runs under `withLock(`${account}/${token}`)`.
     - `export async function syncRegistrations(deps: Deps): Promise<number>`. For each merchant with a gateway, it reads `get_gateway`, then calls `ensureRegistered` for `payout_to` on every token from `get_tokens`. It catches and logs each failure, and returns the number registered.
  4. In `checkout.ts` `invoice`: after `get_invoice`, read `get_gateway(inv.gateway)` and `await ensureRegistered(deps, g.payout_to, inv.token)`. In `main.ts`, after `listen`, call `syncRegistrations(deps).then((n) => console.log(…), console.error)`. Run the tests.
  5. Commit `feat(relay): register payout accounts on new tokens`.

## 3. Web

- [x] 3.1 Remove the payout field from onboarding. Verify that `cd web && npx tsc --noEmit && npx vitest run` passes, and that `grep -n "payout" web/src/console/Onboarding.tsx` finds only the gateway confirmation copy.
  1. In `web/src/console/Onboarding.tsx`, delete:
     - the `PAYOUT` session helper and the `payout` state;
     - the `Payout account` input and `payoutError`;
     - `payoutTo` in the onboard body.

     The gateway step uses `const payoutTo = me.accountId!`.
  2. In `web/src/console/logic.ts`, remove `payoutTo` from `Me`. Run the typecheck and tests.
  3. Commit `refactor(web): no custom payout at onboarding`.

## 4. Mainnet redeploy

- [x] 4.1 Create the account tree. Verify that `near account list-keys` shows:
  - one key on `gateflow.near` (its own);
  - one key on `ops.gateflow.near`;
  - the relay key on both `relay.gateflow.near` and `merchant.gateflow.near`.
  1. As `greatbank5653.near`, call `near.create_account` with `new_account_id: "gateflow.near"`, a new key saved to `~/.near-credentials`, and about 3.2 NEAR.
  2. As `gateflow.near`, create:
     - `ops.gateflow.near`: 0.3 NEAR, own key;
     - `relay.gateflow.near`: 0.5 NEAR, new relay key;
     - `merchant.gateflow.near`: 0.2 NEAR, the same relay public key.
  3. Record all 4 tx hashes under this task.
  - `gateflow.near` (3.98 NEAR, key `ed25519:AkNPKFAVZfSiPx1vA3iiMSMUscenF59eyPmTykQ6ggGy` in the macOS keychain): created by the owner from `greatbank5653.near`, hash not captured.
  - `ops.gateflow.near` (0.3 NEAR, key `ed25519:3J9ZXRk4xPgE6CEGSW2fpt3fbN8KB3YuVSjZ6RwR8qPV`): `HgoAyQguc3nQWLJjkzz3SAtAae8uYPf47dZ2HH5cKESc`
  - `relay.gateflow.near` (0.5 NEAR, relay key `ed25519:EW5prsKaMJkhK2qqjsLRR8A9Gqixx6Q8Vgukernz9YE3`): `H3VEfUP6MY79oYZ6Ltp4pbDPvEgy9XZKcUXeEuBRBrNk`
  - `merchant.gateflow.near` (0.2 NEAR, same relay key): `3ddkPwskYxiuifAd3MJQao87cF9dafbiNbNSyE1EjEB6`
- [x] 4.2 Deploy the enclave for `gateflow.near`. Verify that the 5 direct-call checks in `enclave/README.md` pass from `gateflow.near` (before its code exists) and from `ops.gateflow.near` as the second caller.
  1. Run `GATEFLOW_CONTRACT=gateflow.near cargo build --target wasm32-wasip2 --release` in `enclave/`. Check that `strings` on the wasm shows `gateflow.near`.
  2. `outlayer logout`, then `outlayer login` as `ops.gateflow.near` on mainnet. Then `outlayer upload` and `outlayer deploy gateflow <url>`.
  3. Run the checks with explicit `resource_limits`, then rewrite the Mainnet section of `enclave/README.md`: accounts, SHA256, commit, upload tx and the check table.
  4. Commit `docs(enclave): gateflow.near deployment`.
- [x] 4.3 Deploy the contract. Verify that:
  - `get_operator` returns `ops.gateflow.near`;
  - `get_relay` returns `relay.gateflow.near`;
  - `get_tokens` returns exactly the 3 tokens;
  - `storage_balance_of(gateflow.near)` is not null on each token.
  1. Run `cargo near build non-reproducible-wasm` on the commit that contains 1.1, and record the wasm SHA256.
  2. Run `near contract deploy gateflow.near … with-init-call new` with the Global Constraints args.
  3. As `ops.gateflow.near`, run `add_token` 3 times, then `storage_deposit` for `gateflow.near` on each token. Record the hashes under `mainnet-launch` 1.1, replacing the `gateflow.greatbank5653.near` entries.
- [x] 4.4 Run the relay and onboard a merchant. Verify that:
  - the new merchant's account matches `^[a-z2-7]{8}\.merchant\.gateflow\.near$`;
  - `get_gateway(0)` returns that account as both `owner` and `payout_to`;
  - one paid invoice ends `Settled` with the merchant's balance up by the amount.
  1. Set up `relay/.env`: `GATEFLOW_CONTRACT=gateflow.near`, `RELAY_ACCOUNT_ID=relay.gateflow.near`, `MERCHANT_PARENT=merchant.gateflow.near`, the new `RELAY_PRIVATE_KEY`, and `DB_PATH=gateflow-namespace.db`. Then run `cd web && VITE_NEAR_NETWORK=mainnet npm run build` and start the relay.
  2. Onboard through the console, then pay a 0.01 USDC invoice. Record the hashes under `mainnet-launch` 1.2, which completes its `Settled` check.
- [x] 4.5 Retire the old deployment. Verify that `near account view-account-summary` reports "does not exist" for `gateflow.greatbank5653.near` and `relay.greatbank5653.near`.
  1. Check that `ft_balance_of(gateflow.greatbank5653.near)` is `"0"` on all 3 tokens and that it holds no Pending payment (`get_payments(0, 0, 10)`). Stop if either check fails.
  2. Run `near account delete-account` for both accounts with beneficiary `greatbank5653.near`, and record the hashes. Leave `alex-mainnet-store.relay.greatbank5653.near` and `alex-mainnet-store-gateflow.near` alone.
  - Done on 2026-11-03, before 4.1, to fund the new accounts (`greatbank5653.near` held 0.55 NEAR). Checks: every token balance was `"0"` on both accounts; gateway 0 had 1 payment, `Settled`.
  - Delete `gateflow.greatbank5653.near`: `8HSUDmNQJ79YrusPgNnicv3ciCTbaV1qk4SJgS6FZddT`
  - Delete `relay.greatbank5653.near`: `8yUvH5hmPsE52r2Ho928qgkqLed884KhFQsvTqVXFbND`
  - `greatbank5653.near` balance after: 4.014 NEAR.
- [x] 4.6 Update the docs to the new layout. Verify that `grep -rn "greatbank5653" README.md enclave/README.md relay/README.md openspec/changes/mainnet-launch/tasks.md` matches only historical tx records and the retirement note.
  1. Update:
     - `openspec/changes/mainnet-launch/tasks.md`: rewrite the 1.1 and 1.2 notes to the new accounts;
     - `README.md`: Status, saying the contract is deployed at `gateflow.near` and the enclave runs on OutLayer mainnet.
  2. Commit `docs: gateflow.near layout`.

## Workflow follow-up

- Archive with `/opsx:archive gateflow-namespace` after review. Its `merchant-accounts` REMOVED requirement deletes "Payout account can receive every token", which commit `33f6253` added to the main spec.
- `mainnet-launch` continues from 1.3 against the new deployment.
