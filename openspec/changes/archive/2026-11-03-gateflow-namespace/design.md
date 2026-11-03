# Design

## Context

See proposal.md for why. Requirements are in this change's `specs/`.

Current state that shapes the approach:
- **Live deployment:** the mainnet contract is `gateflow.greatbank5653.near` (deployed from `80bec9e`; its full-access key still exists).
  - operator and enclave owner: `greatbank5653.near`
  - relay: `relay.greatbank5653.near`
  - enclave project: `greatbank5653.near/gateflow`
  - one test merchant: `alex-mainnet-store.relay.greatbank5653.near`
  - payment 0 is `Settled`; the contract holds no payment funds
- **Relay signer:** the relay signs every transaction as one account, `cfg.accountId` (`rpcNear` in `relay/src/near.ts`). Merchant accounts are created as `<slug>.<cfg.accountId>` (`freeAccountId` in `relay/src/console.ts`).
- **Who can create accounts:** only a parent can create its subaccounts. Top-level `*.near` names are created through the `near` account's `create_account(new_account_id, new_public_key)`. On 2026-11-03, `gateflow.near` and `merchant.gateflow.near` did not exist.
- **Payout at transfer time:** `retry` reads the gateway's `payout_to` when it sends the transfer (`receiver()` in `contract/src/closing.rs`), not when the transfer first failed.
- **Commit `33f6253`:** added custom payout accounts: the `payout_to` DB column, top-level account creation, and the "Payout account can receive every token" requirement. This change removes all of that.

## Goals / Non-Goals

**Goals:**
- No settle can fail because a payout account lacks storage on an allowlisted token.
- Every account the system creates is under `gateflow.near`.

**Non-Goals:**
- Moving the test merchant or its funds.
- Changing the contract's push settlement model. A ledger with withdrawals was considered and rejected: funds pass through the contract and do not rest there.
- Sponsoring `set_payout`.

## Decisions

**1. Account layout, all created before the contract deploy.**
```
gateflow.near                  contract; full-access key deleted after setup
  +-- ops.gateflow.near        operator; enclave owner and secrets_owner
  +-- relay.gateflow.near      contract `relay`; signs and sponsors
  +-- merchant.gateflow.near   creates merchant accounts only
        +-- <label>.merchant.gateflow.near
```
Once its key is deleted, `gateflow.near` cannot create a direct subaccount, so all three are created first. Merchants sit one level lower, so creating them later is not affected.

*Alternative considered:* keep the operator as `greatbank5653.near`. That has fewer moving parts, but it keeps a personal account in the trust path.

**2. One relay key, two signers.** The relay's key is a full-access key on both `relay.gateflow.near` and `merchant.gateflow.near`. A new config, `MERCHANT_PARENT`, names the second account, and the relay builds a second `Near` client that signs as it, used only for `createAccount`. Everything else (token registration, `fund`, relayed delegates, `screen_intents`, `retry`) still signs as `relay.gateflow.near`.
- If `MERCHANT_PARENT` is unset, it defaults to `RELAY_ACCOUNT_ID`, so testnet and tests keep working with one account.
- *Alternative considered:* make `merchant.gateflow.near` the relay account itself. That needs no new code, but then the account that calls `screen_intents` and pays gas would carry the merchant namespace's name.

**3. Random label.** Each of 8 characters is drawn from `a-z2-7` with `crypto.randomInt(32)`, giving 40 bits. The relay still checks that the name is free, keeps the existing retry loop with a new label each try, and gives up with 409 after 20 tries. The business name is kept only in the `merchants.name` column, which the console and checkout already read.

**4. No custom payout.**
- `create_gateway` is signed by the merchant with `payout_to` set to its own account.
- The relay's `refusal()` decodes the JSON args of `create_gateway` and returns 403 unless `payout_to` equals `senderId`.
- `set_payout` is not added to the sponsored methods.
- At onboarding, `payoutTo` is ignored.
- From `33f6253`, the creation path, the `payout_to` column and its migration are removed. The new deployment starts with a fresh database, so no migration is needed.

**5. `set_payout(gateway, payout_to)`.** It goes through `owned_gateway_mut`, like `set_policy`, so the same "not the gateway owner" and "unknown gateway" panics apply. It emits no new event, because `get_gateway` shows the current value. A retry already reads the current payout (see Context), so only the spec text changes.

**6. Registration sync.** One helper, `ensureRegistered(account, token)`:
- it reads `storage_balance_of`;
- when that is null, it sends `storage_deposit {registration_only: true}` with `storage_balance_bounds.min`;
- calls for the same account and token run one at a time (the existing `withLock`).

It runs in two places:
- **At startup:** for each merchant with a gateway, it registers the gateway's `payout_to` on every token from `get_tokens`. Startup is not blocked: the HTTP server starts first, and failures are logged.
- **In `GET /checkout/invoice`:** for the invoice's gateway's `payout_to` and the invoice's token, before answering. A registration failure answers 502, because a payment could not settle.

`registration_only: true` refunds the deposit if a concurrent caller registered first, so a race costs only gas.

## Risks / Trade-offs

- [Deleting the old contract account with its tokens still registered loses 0.00375 NEAR of token storage] → Accepted. First check that the old contract's balance on each token is 0.
- [The checkout costs an extra view call on every load] → One `storage_balance_of` per load, and a transaction only on the first load after a token is added.
- [`ops.gateflow.near` needs its own OutLayer login, and the enclave project moves] → The old project `greatbank5653.near/gateflow` stays in place until the new one passes the direct-call checks.
- [A token allowlisted while the relay is down, then paid directly with `ft_transfer_call` without opening a checkout] → The startup sync covers it before the relay serves traffic again. A settle that slips through ends up `SettleFailed`, and the existing retry recovers it.
- [The same relay key on two accounts] → If the key is compromised, both accounts are lost, and that is no worse than today, since the relay key already controls all sponsorship funds. `merchant.gateflow.near` holds only enough NEAR to create accounts.

## Migration Plan

1. `greatbank5653.near` calls `near.create_account` for `gateflow.near` with a new key, funded with about 3.2 NEAR. Then `gateflow.near` creates `ops.`, `relay.` and `merchant.gateflow.near`. The relay key goes on both `relay.` and `merchant.`.
2. Build the enclave with `GATEFLOW_CONTRACT=gateflow.near`. Run `outlayer login` as `ops.gateflow.near`, then upload and deploy project `ops.gateflow.near/gateflow`. Run the 5 direct-call checks, signed as `gateflow.near` while it has no code yet.
3. Deploy the contract with `set_payout` to `gateflow.near`, calling `new(ops.gateflow.near, relay.gateflow.near, intents.near, {outlayer.near, ops.gateflow.near/gateflow, ops.gateflow.near}, 0.01 NEAR)`. Then `ops` calls `add_token` 3 times, followed by `storage_deposit` for the contract on each token.
4. Start the relay with `GATEFLOW_CONTRACT=gateflow.near`, `RELAY_ACCOUNT_ID=relay.gateflow.near`, `MERCHANT_PARENT=merchant.gateflow.near` and a fresh `DB_PATH`. Rebuild the web app.
5. Onboard one merchant and pay one invoice (`mainnet-launch` 1.2/1.3).
6. Retire the old deployment:
   - delete `gateflow.greatbank5653.near` and `relay.greatbank5653.near` with beneficiary `greatbank5653.near`, after checking their token balances are 0;
   - leave the test merchant accounts alone.
7. The full-access key of `gateflow.near` stays until the owner decides (`mainnet-launch` 1.1).

**Rollback:** until step 6, the old deployment keeps working. Point the relay back at it by restoring the old `.env`.
