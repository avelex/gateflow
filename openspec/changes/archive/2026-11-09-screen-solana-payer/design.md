# Design

## Context

Screening of a 1Click payment happens only in the enclave's `screen_intents` (`enclave/src/flows.rs`). It reads 1Click's status for the deposit, checks the binding, maps the origin asset to its 1Click `blockchain`, then branches per chain: EVM goes through RPC `from` to GoPlus, `btc` through Blockstream inputs to OFAC XBT, and `zec` through Blockchair transparent inputs to OFAC ZEC. Any other chain returns `Some(false)`. The relay mirrors the same per-chain lookups in `relay/src/origin.ts`, for console display only, and gates quotes with `screenable()` in `relay/src/checkout.ts`. Existing tests assert that `sol` is excluded (`relay/src/checkout.test.ts:452`, `relay/src/origin.test.ts:35`). They flip with this change.

The contract has no chain logic and requests the OutLayer project's active version. A new enclave version therefore applies to `gateflow.near` with no contract change.

## Goals / Non-Goals

**Goals:**
- Solana deposits are screened with the same fail-closed rules as Bitcoin and Zcash.
- The enclave and the relay resolve the same Solana senders from the same endpoint.

**Non-Goals:**
- GoPlus for Solana. Its address API answered `{"code":5000}` for a Solana address on 2026-11-09, and a fail-closed screener would refund every payment.
- A Solana wallet payer option in the checkout. The payer sends to the deposit address from any wallet, as with Bitcoin and Zcash.
- Native SOL or other SPL tokens beyond what `sameAssets` already matches by `coingeckoId` and symbol. Any match is quotable, but USDC is the target.

## Decisions

**Senders are every signer of the transaction.** A Solana transfer's source authority must sign, and the fee payer signs too. Screening every `accountKeys` entry with `signer: true` covers both without parsing instructions. This mirrors Bitcoin, where every input address is screened. Alternative: parse the SPL `transferChecked` instruction and take only its `authority`. That is more exact, but it is more code, and it misses senders who use other instruction shapes (wrapped SOL, programs). A sponsored transaction then also screens the sponsor. That is a false refund only if the sponsor itself is sanctioned.

**Read with `getTransaction`, `encoding: jsonParsed`, `maxSupportedTransactionVersion: 0`, `commitment: confirmed`.** `jsonParsed` gives `accountKeys` as `{pubkey, signer}` objects, so no message decoding is needed. Version 0 is needed, or v0 transactions return an error. `confirmed` rather than the default `finalized`: 1Click reports `SUCCESS` soon after delivery, and a not-yet-finalized transaction returns `null`, which fails closed and refunds a clean payer. Alternative: `finalized`, which is safer against forks but risks those refunds. For a deposit 1Click already credited, `confirmed` is enough.

**Endpoint `https://solana-rpc.publicnode.com`, fixed at build.** This is the same provider as the EVM RPCs and needs no key, so the enclave stays secret-free. It is set in one place in the enclave (`origin.rs`) and mirrored in the relay (`origin.ts`). Alternative: `api.mainnet-beta.solana.com`, which is rate-limited and blocks some datacenter IPs.

**OFAC list `sanctioned_addresses_SOL.txt` from the 0xB10C lists branch.** This is the same source and the same `ofac_score` as XBT and ZEC. Addresses are base58 and case-sensitive, so they are compared as-is (no lowercasing, unlike EVM).

**Hash check unchanged.** Solana signatures are base58, which is alphanumeric, so they already pass the guard at `flows.rs:56` before going into JSON-RPC params.

## Risks / Trade-offs

- [The OFAC SOL list is tiny (4 addresses)] → Solana screening is sanctions-only, like BTC and ZEC. The README and Status say so plainly. GoPlus stays a roadmap item until its live call works.
- [publicnode rate-limits or fails from the OutLayer worker] → The result is `false` and a refund, which is correct but costly for the payer. Verify one live call from the enclave in the mainnet check before announcing.
- [1Click's blockchain id for Solana is not `sol`] → The relay test fixtures already use `sol`. Confirm against live `GET /v0/tokens` before deploying.
- [The relay and the enclave disagree on senders] → Both use the same request and the same `signer: true` rule, each with its own test over the same fixture shape.

## Migration Plan

1. Merge the enclave and relay code with tests.
2. Build the mainnet enclave wasm. As `ops.gateflow.near`, run `outlayer upload` and `outlayer deploy gateflow <url>`. Record the new wasm hash.
3. Deploy the relay to Fly.io. Quotes for Solana open only now, so no Solana payment can reach an old enclave version.
4. Pay one small USDC invoice from Solana. Expect `Settled`, an attestation showing the new wasm hash, and the payer shown "on Solana" in the console.

Rollback: `outlayer deploy` the previous wasm URL and redeploy the previous relay. A Solana payment that lands in between is refunded by the old enclave (fail closed), so no funds are at risk.
