# Mainnet Launch Plan

**Goal:** Run Gateflow on mainnet and clear one live payment per supported origin (Base USDC, BTC, transparent ZEC), plus one binding-mismatch refund.

**Origin:** tasks 6.1–6.5 of the archived `screen-cross-chain-payer` change, rewritten for the token allowlist model (one gateway per merchant, not one per token), plus the testnet tasks 7.1–7.2 of the archived `contract-from-scratch` change.

**Runbook:** `GOAL.md` → Engineering notes (deployment, enclave secrets, relay env).

## Global Constraints

- Fresh deployment: no state migration from testnet.
- Contract wasm: `cd contract && cargo near build non-reproducible-wasm` → `contract/target/near/gateflow.wasm` (Rust 1.86.0 pinned).
- Init: `new(operator, relay, intents, enclave {outlayer, project, secrets_owner}, execution_deposit)`. The relay is the account in `RELAY_ACCOUNT_ID`; only it can call `screen_intents`.
- Deleting the contract account's full-access key is irreversible: the code can never change afterwards. Confirm with the owner before each deletion.
- Tokens: USDC `17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1`, nBTC `nbtc.bridge.near`, ZEC `zec.omft.near`.
- Every payment goes through the relay's checkout, not hand-built 1Click quotes.
- Record every transaction hash in `GOAL.md` next to the task number.

## 0. Testnet rehearsal

- [ ] 0.1 Deploy to a fresh testnet account with `new(...)` (a test account as `intents`, because `intents.near` does not exist on testnet), `add_token` a test token, `storage_deposit` the contract on it, then delete the account's full-access key; verify `near account list-keys <account>` shows no keys and `get_operator` and `get_relay` return the configured accounts
- [ ] 0.2 Run one direct invoice payment from a named testnet account, attaching at least 200 Tgas to `ft_transfer_call`; verify through the explorer that the receipt chain is `ft_on_transfer` → OutLayer → `on_screened` → `ft_transfer` → `on_closed`, the payment ends `Refunded` (named accounts fail screening), the invoice is `Returned`, and the logs carry `payment_opened` and `payment_closed`; record the tx hash in `GOAL.md`

## 1. Deploy

- [ ] 1.1 Deploy a fresh mainnet `gateflow` contract with `new(...)` (`intents` = `intents.near`), `add_token` the three tokens, `storage_deposit` the contract on each, then delete the account's full-access key; verify `get_tokens` returns exactly those three and `near account list-keys` shows no keys
- [ ] 1.2 Register the OutLayer enclave with its mainnet secrets (`EVM_RPC_URLS`, optional `ONECLICK_API_KEY`) and point the contract at it with `set_enclave`; verify a direct NEAR test payment from a clean account reaches `Settled`
- [ ] 1.3 Start the relay against mainnet (`GATEFLOW_CONTRACT`, `RELAY_ACCOUNT_ID`, `RELAY_PRIVATE_KEY`, `NEAR_RPC_URL`, `VITE_NEAR_NETWORK=mainnet` build) and onboard one merchant through the console; verify `get_gateway` for that merchant's gateway returns its owner, payout account and fuel

## 2. Live cross-chain payments

- [ ] 2.1 Pay a 1 USDC invoice from Base through the checkout; verify `get_payment` shows `Settled`, the invoice is `Paid`, and the merchant gains 1 USDC. Record the `sender_id` of the delivery's `ft_on_transfer` (must be `intents.near`, design decision 10 of `contract-from-scratch`) and the gas 1Click attached. Save the `/v0/status` response as `enclave/tests/fixtures/oneclick-status-success.json` and check `jq -e '.status=="SUCCESS" and (.swapDetails.originChainTxHashes|length>0)'`
- [ ] 2.2 Pay a 0.0001 nBTC invoice from native BTC; verify `Settled` and that the merchant gains nBTC
- [ ] 2.3 Pay a ZEC invoice from a transparent address; verify `Settled` and that the merchant gains `zec.omft.near`

## 3. Negative check

- [ ] 3.1 As the relay account, call `screen_intents` on a Pending `ref` payment with the deposit address of a different quote; verify the payment becomes `Refunded` to its `refund_to` and the invoice becomes `Returned`

## Workflow follow-up

- Update the README Status section once all tasks pass.
- Run `/opsx:archive mainnet-launch` after review.
