# Mainnet Launch Plan

**Goal:** Run Gateflow on mainnet and clear one live payment per supported origin (Base USDC, BTC, transparent ZEC), plus one binding-mismatch refund.

**Origin:** tasks 6.1–6.5 of the archived `screen-cross-chain-payer` change, rewritten for the token allowlist model (one gateway per merchant, not one per token), plus the testnet tasks 7.1–7.2 of the archived `contract-from-scratch` change, plus tasks 1.1, 5.1 and 5.2 of the archived `enclave-from-scratch` change (carried over while FastFS testnet was down).

**Runbook:** `GOAL.md` → Engineering notes (deployment, relay env); `enclave/README.md` (enclave build and deploy, written in 0.4).

## Global Constraints

- Fresh deployment: no state migration from testnet.
- Contract wasm: `cd contract && cargo near build non-reproducible-wasm` → `contract/target/near/gateflow.wasm` (Rust 1.86.0 pinned).
- Init: `new(operator, relay, intents, enclave {outlayer, project, secrets_owner}, execution_deposit)`. The relay is the account in `RELAY_ACCOUNT_ID`; only it can call `screen_intents`.
- Deleting the contract account's full-access key is irreversible: the code can never change afterwards. Confirm with the owner before each deletion.
- Tokens: USDC `17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1`, nBTC `nbtc.bridge.near`, ZEC `zec.omft.near`.
- Every payment goes through the relay's checkout, not hand-built 1Click quotes.
- Record every transaction hash in `GOAL.md` next to the task number.

## 0. Testnet rehearsal

Run 0.3 and 0.4 before 0.1: the contract needs a working enclave project.

- [ ] 0.1 Deploy to a fresh testnet account with `new(...)` (a test account as `intents`, because `intents.near` does not exist on testnet), `add_token` a test token, `storage_deposit` the contract on it, then delete the account's full-access key; verify `near account list-keys <account>` shows no keys and `get_operator` and `get_relay` return the configured accounts
- [ ] 0.2 Run one direct invoice payment from a named testnet account, attaching at least 200 Tgas to `ft_transfer_call`; verify through the explorer that the receipt chain is `ft_on_transfer` → OutLayer → `on_screened` → `ft_transfer` → `on_closed`, the payment ends `Refunded` (named accounts fail screening), the invoice is `Returned`, and the logs carry `payment_opened` and `payment_closed`; record the tx hash in `GOAL.md`
- [ ] 0.3 Run the OutLayer spike from design decision 8 of the archived `enclave-from-scratch` change (its tasks.md 1.1). The `gateflow-spike` project is already deployed under `curator-poc-1792584727.testnet`; only rerun the `request_execution` calls with `input_data` `x`, `pred` and `http`. Verify (a) the `x` result bytes are exactly `true`, (b) `pred` returns the calling account, (c) `http` returns `true`, and record (d) whether an absent secrets profile fails the run. Record the results and tx hashes under decision 8 in that archived design. Stop if (a), (b) or (c) fails
- [ ] 0.4 Deploy the enclave to testnet and run the direct-call checks (archived `enclave-from-scratch` tasks.md 5.1): build with `GATEFLOW_CONTRACT=<test account>`, `outlayer upload` and `outlayer deploy gateflow <url>`, then verify `screen` gives `false` for `alice.testnet`, `true` for a clean `0x…` EOA and `false` for `0x098b716b8aaf21512996dc57eb0615e2383e2f96`, `screen_intents` with an unknown deposit address gives `false`, and a second caller gets `null`. Write `enclave/README.md` (build per network, upload and deploy commands, wasm SHA256, tx hashes)

## 1. Deploy

- [ ] 1.1 Deploy a fresh mainnet `gateflow` contract with `new(...)` (`intents` = `intents.near`), `add_token` the three tokens, `storage_deposit` the contract on each, then delete the account's full-access key; verify `get_tokens` returns exactly those three and `near account list-keys` shows no keys
- [ ] 1.2 Build the enclave with `GATEFLOW_CONTRACT=<mainnet gateflow account>`, then `outlayer upload` and `outlayer deploy gateflow <url>` as the account named in `enclave.secrets_owner`. Store a placeholder `default` profile only if 0.3 (d) required it. Call `set_enclave` if the project differs from the one given to `new(...)`. Verify a direct NEAR test payment from a clean account reaches `Settled`
- [ ] 1.3 Start the relay against mainnet (`GATEFLOW_CONTRACT`, `RELAY_ACCOUNT_ID`, `RELAY_PRIVATE_KEY`, `NEAR_RPC_URL`, `VITE_NEAR_NETWORK=mainnet` build) and onboard one merchant through the console; verify `get_gateway` for that merchant's gateway returns its owner, payout account and fuel

## 2. Live cross-chain payments

- [ ] 2.1 Pay a 1 USDC invoice from Base through the checkout; verify `get_payment` shows `Settled`, the invoice is `Paid`, and the merchant gains 1 USDC. Record the `sender_id` of the delivery's `ft_on_transfer` (must be `intents.near`, design decision 10 of `contract-from-scratch`) and the gas 1Click attached. Save the `/v0/status` response as `enclave/tests/fixtures/oneclick-status-live.json` (not `-success.json`, which the unit tests rely on) and check `jq -e '.status=="SUCCESS" and (.swapDetails.originChainTxHashes|length>0)'`
- [ ] 2.2 Pay a 0.0001 nBTC invoice from native BTC; verify `Settled` and that the merchant gains nBTC
- [ ] 2.3 Pay a ZEC invoice from a transparent address; verify `Settled` and that the merchant gains `zec.omft.near`

## 3. Negative check

- [ ] 3.1 As the relay account, call `screen_intents` on a Pending `ref` payment with the deposit address of a different quote; verify the payment becomes `Refunded` to its `refund_to` and the invoice becomes `Returned`

## Workflow follow-up

- Update the README once all tasks pass: in Status, say the enclave is deployed and that `relay/`, `web/` and `GOAL.md` are not yet in this repository (if still true); in the Modules row for `enclave/`, add "no secrets; caller fixed at build". Carried from `enclave-from-scratch` 5.2.
- Run `/opsx:archive mainnet-launch` after review.
