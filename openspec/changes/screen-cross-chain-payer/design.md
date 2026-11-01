# Design

## Context

See proposal.md, "Why". Facts that shape the approach:

- A NEAR contract cannot see other chains or call HTTP. The OutLayer enclave can make HTTP calls and is already trusted for the screening verdict.
- 1Click `GET /v0/status?depositAddress=` returns `status`, the original `quoteResponse.quoteRequest` (including `recipient`, `customRecipientMsg`, `originAsset`) and `quoteResponse.quote.amountOut`, plus `swapDetails.originChainTxHashes`. It does not return the origin sender. Verified live 2026-10-30: the echo of `customRecipientMsg` is present, and status and quotes work without an API key (anonymous quotes charge about 1% more).
- `customRecipientMsg` is used only when 1Click delivers on NEAR. The destination asset id decides the delivery chain: `nep141:btc.omft.near` means native Bitcoin ("recipient is not valid" for a NEAR account), `nep141:nbtc.bridge.near` means nBTC on NEAR, and `1cs_v1:near:nep141:zec.omft.near` means ZEC on NEAR. Verified with live quotes for BTC → nBTC, BTC → ZEC-on-NEAR and ZEC → ZEC-on-NEAR.
- The 1Click docs warn that funds are lost if the recipient's `ft_on_transfer` fails or its storage is insufficient.
- The deposit address exists only in the quote's reply, so it cannot be placed in `customRecipientMsg`.

```
page        relay                 1Click            gateflow                     enclave
 |--quote--->| ref = rand128        |                  |                          |
 |           |--quote(msg{gw,ref,refund_to})-------->|                          |
 |<--addr,ref|                      |                  |                          |
 |==pay on origin chain (EVM/BTC/ZEC)=>|               |                          |
 |           |                      |--ft_transfer_call(msg)-->  Pending(ref)      |
 |--screen(addr,ref)-->|            |                  |                          |
 |           |--status==SUCCESS?--->|                  |                          |
 |           |--screen_intents(payment, addr)--------->|--request_execution------>|
 |           |                      |<---------------- GET /v0/status ------------|
 |           |                      |   origin chain API: tx -> senders           |
 |           |                      |   screener per chain: GoPlus / OFAC list    |
 |           |                      |                  |<-------- true/false -----|
 |           |                      |                  | settle / refund          |
 |           |                      |                  |  ft_transfer --> on_closed|
```

## Goals / Non-Goals

**Goals:**
- Screen the origin-chain senders of 1Click payments from EVM chains, Bitcoin and transparent Zcash before they settle.
- Never make a 1Click delivery fail at `ft_on_transfer`.
- Keep the relay stateless and unable to influence the verdict.
- Never mark a payment Settled or Refunded when its token transfer failed.

**Non-Goals:**
- Shielded Zcash senders (they fail closed).
- Taint analysis: BTC and ZEC are checked only against sanctioned addresses.
- Refunds back to the origin chain or to an Intents balance.
- Multi-token gateways: one gateway accepts one token.
- Changing the direct NEAR payment path.

## Decisions

1. **Bind by `ref`, verified in the enclave.** The relay picks a random 128-bit `ref`. The enclave accepts a deposit address only if 1Click's stored quote has `recipient` = the Gateflow contract, a `customRecipientMsg` naming the payment's gateway and `ref`, and `quote.amountOut` equal to the payment amount.
   - Rejected: a ref-to-address map in the relay (adds state).
   - Rejected: matching `swapDetails.nearTxHashes` (the contract does not know its own receipt's tx hash).
   - Rejected: screening `refundTo` (chosen by the payer, so it proves nothing).
2. **Defer screening to a second call.** `ft_on_transfer` only records the payment, and `screen_intents` starts the enclave run. Screening at delivery would race 1Click's bookkeeping, and the deposit address is unknown at that point.
3. **`screen_intents` is permissionless, once per payment.** The stored deposit address marks screening as started. Fuel is drawn here. Without fuel the call fails, and `reclaim` refunds after 15 minutes.
4. **Deposit-time rejections become refunds for `ref` payments.** A duplicate `ref` opens the payment and refunds it in the same call. An unparseable `msg`, an unknown gateway or a wrong token still panics, because no valid payment can be recorded. The relay never produces those.
5. **One gateway per token; merchants receive the payer's asset on NEAR.**
   - EVM payers pay into a USDC gateway (`17208628…` native USDC).
   - BTC payers pay into an nBTC gateway (`nbtc.bridge.near`, the Omni bridge on chain signatures).
   - ZEC payers pay into a ZEC gateway (`zec.omft.near`).
   - Rejected: `btc.omft.near` for BTC (1Click cannot deliver it to a NEAR account), and multi-token gateways (contract change for no current need).
6. **Relay maps the gateway token to the 1Click destination id via `/v0/tokens`.** It picks the asset with `blockchain == "near"` whose id ends in `:<token>` or equals `nep141:<token>`. This yields `nep141:nbtc.bridge.near` and `1cs_v1:near:nep141:zec.omft.near` without hard-coding.
7. **Origin chain comes from 1Click, not from the payer.** The enclave maps `quoteRequest.originAsset` to its `blockchain` with `/v0/tokens`, then dispatches to a resolver:

   | `blockchain` | Sender resolver | Screener |
   |---|---|---|
   | in `EVM_RPC_URLS` (e.g. `base`, `eth`, `arb`) | `eth_getTransactionByHash` → `from` | GoPlus (existing) |
   | `btc` | Esplora `GET https://blockstream.info/api/tx/{txid}` → each `vin[].prevout.scriptpubkey_address` (mempool.space timed out in testing) | OFAC list `XBT` |
   | `zec` | Blockchair `GET https://api.blockchair.com/zcash/dashboards/transaction/{hash}` → `data.<hash>.inputs[].recipient` | OFAC list `ZEC` |
   | anything else | none | fail closed |

   Every sender across every origin tx must pass. A transaction without a resolvable sender, such as a ZEC tx with no transparent inputs or a BTC coinbase, fails closed.
8. **OFAC list screener.** It fetches `sanctioned_addresses_{XBT,ZEC}.txt` from `github.com/0xB10C/ofac-sanctioned-digital-currency-addresses` (branch `lists`). A listed address scores 100, any other 0, compared against `max_risk`. A failed fetch fails closed.
   - Rejected: embedding the list in the enclave binary (stale without a new version).
   - Rejected: a paid KYT API (no keys; can replace this screener later behind the same trait).
9. **Payout transfers report back.** `close()` chains `ft_transfer` with an `on_closed(payment)` callback. If the transfer failed, the payment moves to `SettleFailed` or `RefundFailed` instead of staying `Settled` or `Refunded`. A permissionless `retry(payment)` re-sends to the same receiver, for example after it has registered storage.
10. **The relay calls `screen_intents` only after 1Click `SUCCESS`.** The enclave still requires `SUCCESS` itself, so a premature call refunds and never settles.
11. **`ONECLICK_API_KEY` is optional** in the relay and the enclave. The header is sent only when it is set.

## Risks / Trade-offs

- [Relay never calls `screen_intents`] → `reclaim` refunds after 15 minutes. The relay can only delay, never approve.
- [BTC needs ~13 minutes on 1Click (quote `timeEstimate` 805 s)] → the clearing window starts at delivery to Gateflow, not at the BTC deposit, so it is unaffected.
- [The refund is in nBTC or ZEC on NEAR, not native coins; the payer needs a NEAR account with storage on that token] → `refundOnNear` is required. A missing registration becomes `RefundFailed` and can be retried after `storage_deposit`.
- [The OFAC list catches only sanctioned addresses, not stolen funds] → accepted for the hackathon; the screener is replaceable.
- [The Blockstream, Blockchair (free tier, rate-limited) or GitHub raw APIs are down] → fail closed (refund).
- [Anonymous 1Click costs about 1% more] → set `ONECLICK_API_KEY` once a partner key exists.
- [Enclave latency: status + tokens + chain API + list fetch exceeds OutLayer limits] → each call fails closed; measure in 7.1.

## Migration Plan

Deploy a fresh `gateflow` on mainnet, because the state layout changes. Call `storage_deposit` for `gateflow` on the USDC, `nbtc.bridge.near` and `zec.omft.near` tokens, then create one gateway per token. Register the new enclave version with secrets `EVM_RPC_URLS` and optionally `ONECLICK_API_KEY`. Rollback: the relay stops issuing quotes. Direct NEAR payments are unaffected.

## Open Questions

- Whether `KNOWN_DEPOSIT_TX` or `PROCESSING` can appear after the delivery to Gateflow; if so, the relay's wait condition needs adjusting.
