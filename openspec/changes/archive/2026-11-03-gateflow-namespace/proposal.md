# Proposal

## Why

Mainnet payment 0 failed with "not registered": it settled to a payout account the merchant typed in, which did not exist and was registered on no token. The deployment also sits under a personal account (`gateflow.greatbank5653.near`), and merchant account names (`<slug>.relay.greatbank5653.near`) put business names on chain forever.

The contract's full-access key still exists, so this is the last chance to change the contract code and the account layout.

## What Changes

- **BREAKING:** a fresh deployment under `gateflow.near`. The contract is `gateflow.near`, the operator and enclave owner is `ops.gateflow.near`, the relay is `relay.gateflow.near`, and merchant accounts are created under `merchant.gateflow.near`. Nothing migrates from `gateflow.greatbank5653.near`. That deployment is retired and its NEAR reclaimed.
- **BREAKING:** merchant accounts become `<label>.merchant.gateflow.near`, where `<label>` is 8 random base32 characters. They are no longer named after the business. The business name stays in the backend database only.
- **BREAKING:** custom payout accounts are removed. A gateway always pays out to the merchant's own account, which the backend creates and registers on every allowlisted token. This removes the onboarding payout field and the top-level `name.near` creation added in `33f6253`. The relay sponsors `create_gateway` only when `payout_to` equals the sender.
- The backend registers gateway payout accounts on tokens allowlisted later, at startup and before a checkout, so a new token cannot make settles fail.
- The contract gains an owner-only `set_payout(gateway, payout_to)`. A retry of a `SettleFailed` payment goes to the gateway's current payout account, so a stuck settle can be redirected. It is not sponsored: custom payouts stay off in the console for now.
- `mainnet-launch` 1.1 and 1.2 are redone for the new accounts.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `merchant-accounts`:
  - accounts become `<random>.merchant.gateflow.near` instead of `<slug>.<operator>`;
  - there is no custom payout;
  - the backend keeps payout accounts registered on tokens allowlisted later.
- `merchant-gateways`: adds the owner-only `set_payout`.
- `payment-clearing`: a retried settle goes to the gateway's current `payout_to`, not the receiver of the failed transfer.
- `sponsored-transactions`: `create_gateway` is sponsored only with `payout_to` equal to the sender.

## Impact

- **Contract** (`contract/src/gateways.rs`, `closing.rs`): add `set_payout` and its tests, then do a fresh mainnet deploy.
- **Enclave:** rebuild with `GATEFLOW_CONTRACT=gateflow.near`, and deploy it as project `ops.gateflow.near/gateflow`.
- **Relay** (`relay/src/console.ts`, `delegate.ts`, `db.ts`, `types.ts`):
  - a random label replaces the slug;
  - a new config `MERCHANT_PARENT`, with the relay key also added to `merchant.gateflow.near`;
  - the custom-payout path and the `payout_to` column are removed;
  - a registration sync runs at startup and before a checkout;
  - the `create_gateway` args are checked before sponsoring.
- **Web** (`web/src/console/Onboarding.tsx`): remove the payout field. `create_gateway` uses the merchant's own account.
- **Operations:**
  - Create the 3 subaccounts of `gateflow.near` before its key is deleted: it can never create one after.
  - Storage costs about 2.8 NEAR. Deleting the old contract and relay accounts returns about 3.5.
  - The relay starts with a fresh database.
- **Out of scope:** withdrawing from a merchant account, a custom-payout UI, BYOK.
