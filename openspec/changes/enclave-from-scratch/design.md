# Design

## Context

See proposal.md, "Why". Requirements: `payment-clearing` (the existing enclave requirements plus this change's delta).

**The interface is fixed by the deployed contract design** (`contract/src/payments.rs`, `contract/src/screening.rs`, `contract/src/closing.rs`):
- Requests (stdin, from `input_data`):
  - `{"kind":"screen","payer":<account>,"max_risk":<u8>}`
  - `{"kind":"screen_intents","deposit_address":<str>,"invoice":<u64>,"ref":<str>,"amount":<u128 as string>,"max_risk":<u8>}`
- Call shape: `request_execution` with `response_format: "Json"`, `resource_limits: {}` (60 s, 1B instructions), and `secrets_ref {profile: "default", account_id: secrets_owner}`, with no version pin (the active project version runs).
- Verdict: `on_screened` reads at most 64 bytes and approves only on `serde_json::from_slice::<bool>(bytes) == Ok(true)`. A failed execution credits `execution_deposit` back to the gateway's fuel from the contract balance, and refunds the payment.

**OutLayer guest facts** (app.outlayer.ai/docs: dev-guide, wasi, sdk, near-integration, secrets, projects, pricing; read 2026-11-01):
- HTTP works only on `wasm32-wasip2`, through `wasi-http-client`.
- Input arrives on stdin. Output goes to stdout as UTF-8 JSON, at most 900 bytes, and must be flushed.
- Env vars include `NEAR_PREDECESSOR_ID` and `NEAR_SENDER_ID`. Secrets are injected as env vars too.
- **Not documented:**
  - the exact callback bytes for a `Json` result;
  - whether a secret can override a system variable;
  - whether a missing secrets profile fails the execution.
- Projects: `outlayer upload <wasm>` (FastFS URL and SHA256), then `outlayer deploy <name> <url>`. The project id is `<owner>/<name>`.

**Prior art:** decisions 7 and 8 of the archived `screen-cross-chain-payer` design (resolvers, OFAC lists). Its code is not in this repository, and neither are its recorded fixtures.

## Goals / Non-Goals

**Goals:**
- A guest that implements the enclave requirements of `payment-clearing` exactly, with no contract change.
- Verdict logic testable on the host with `cargo test`, without network access.

**Non-Goals:**
- Retries, caching across runs, or OutLayer persistent storage.
- Shielded ZEC, taint analysis, or providers beyond GoPlus and the OFAC lists.
- The `outlayer` SDK crate. Storage and host functions are not needed.

## Decisions

**1. One binary, pure core.**
- Files:
  - `main.rs`: wasi only. stdin, `NEAR_PREDECESSOR_ID`, the `wasi-http-client` fetch, stdout.
  - `lib.rs`: `run` (the caller check and parse, then the verdict).
  - `request.rs`: the serde request enum.
  - `flows.rs`: `screen` and `screen_intents`.
  - `oneclick.rs`: binding and origin-chain mapping.
  - `goplus.rs`: score table.
  - `origin.rs`: EVM, BTC and ZEC sender parsers, plus `all_pass`.
  - `ofac.rs`: list lookup.
- The flows take `fetch: &dyn Fn(&Http) -> Option<String>`, where `Http` is `{method, url, body}`. Tests pass a closure over a fixture map. There is no trait and no mock crate, and the host build does not need `wasi-http-client`.
- *Rejected:* a `Fetcher` trait. It has a single real implementation.

**2. Output: `true`, `false` or `null`, and never a panic.**
- `main` computes an `Option<bool>`:
  - a foreign `NEAR_PREDECESSOR_ID`, or none at all, gives `None` and prints `null`;
  - anything else gives `Some(verdict)`.
- After printing, `main` calls `flush()`. Write errors are ignored, because nothing better can be done.
- Every external value is read with `?` on `Option`. There is no `unwrap`, `expect`, or slice indexing on fetched or request data. An unreadable request gives `false`.
- **Why:** a panic is a failed execution, and the contract pays it back into fuel. A guest that panics on bad input lets anyone who can trigger a screening refund payments at the operator's expense.
- wasm targets abort on panic (no `catch_unwind`), so this is a review rule, enforced by a grep in task 5.2.

**3. Build-time configuration.**
- `const GATEFLOW_CONTRACT: &str = env!("GATEFLOW_CONTRACT");` Building without it is a compile error.
- EVM RPC map:
  - `base` → `https://base-rpc.publicnode.com`
  - `eth` → `https://ethereum-rpc.publicnode.com`
  - `arb` → `https://arbitrum-one-rpc.publicnode.com`
- 1Click: `https://1click.chaindefuser.com/v0`, with no `X-API-Key`.
- The guest never calls `std::env::var` except for `NEAR_PREDECESSOR_ID`. That makes secret injection irrelevant, apart from that one variable (see Risks).
- *Rejected:* config through secrets. An operator mistake, or any party that controls the profile, could point the check at another contract.

**4. `screen` (direct).**
- The payer must match `^0x[0-9a-f]{40}$`. NEAR account ids are lowercase. Anything else gives `false` without a request.
- `GET https://api.gopluslabs.io/api/v1/address_security/{payer}?chain_id=1`.
- `goplus::score(body) -> Option<u8>`:
  - `code == 1` and `result` is an object, else `None`;
  - the score is the highest weight among the fields equal to `"1"` (and `number_of_malicious_contracts_created > 0`), using the delta's tiers.
- Unknown fields are ignored, including `contract_address` and `data_source`. A field GoPlus adds later scores 0 until the table lists it (see Risks).
- Verdict: `score <= max_risk`.

**5. `screen_intents`.**
1. `GET /v0/status?depositAddress=<addr>`. `oneclick::binding(body, GATEFLOW_CONTRACT, invoice, ref, amount) -> bool` checks five things:
   - `status == "SUCCESS"`;
   - `quoteResponse.quoteRequest.recipient == GATEFLOW_CONTRACT`;
   - `customRecipientMsg` parses as JSON with `invoice` equal to the request's invoice;
   - `ref` in that JSON equal to the request's `ref`;
   - `quoteResponse.quote.amountOut == amount`, compared as strings.

   Extra keys in the message, such as `gateway` or `refund_to`, are ignored.
2. `GET /v0/tokens`. The `blockchain` of the asset whose `assetId == quoteRequest.originAsset` is the origin chain.
3. Origin transactions are `swapDetails.originChainTxHashes[].hash`. An empty list gives `false`.
4. Resolve and score:

   | chain | resolve | score |
   |---|---|---|
   | `base`, `eth`, `arb` | JSON-RPC `eth_getTransactionByHash` → `result.from`, lowercased | GoPlus (decision 4) |
   | `btc` | `GET https://blockstream.info/api/tx/{hash}` → every `vin[].prevout.scriptpubkey_address` | OFAC `XBT` list |
   | `zec` | `GET https://api.blockchair.com/zcash/dashboards/transaction/{hash}` → `data.<hash>.inputs[].recipient` | OFAC `ZEC` list |
   | other | none | `false` |

   - A transaction with zero senders, or with any input that has no address, gives `false`.
5. `all_pass(senders, score, max_risk)`: false on an empty list, and false if any score is `None` or above `max_risk`.

- Each OFAC list (`raw.githubusercontent.com/0xB10C/ofac-sanctioned-digital-currency-addresses/lists/sanctioned_addresses_{XBT,ZEC}.txt`) is fetched at most once per run. A listed address scores 100, and any other scores 0.

**6. Tests on fixtures.**
- `enclave/tests/fixtures/` holds hand-written JSON in the documented shapes:
  - 1Click status for SUCCESS and PROCESSING, and `/v0/tokens`;
  - GoPlus clean, low and severe;
  - EVM tx, BTC tx (including a coinbase), and ZEC tx (transparent and shielded);
  - OFAC list excerpts.
- The spike (task 1.2) replaces the GoPlus and chain fixtures with live captures where possible.
- `mainnet-launch` 2.1 adds the live `oneclick-status-success.json`.

**7. HTTP.** `wasi-http-client` 0.2, the version used by the archived plan. Every non-2xx status, timeout or body read error returns `None`. There is no retry: a refund is the safe outcome, and the 60 s budget covers at most about 2 + 2N requests (status, tokens, one tx and one GoPlus call per EVM sender, or one list per BTC/ZEC run).

**8. Spike before code.** A hello guest on testnet, called by `request_execution` directly from a test account. It must show:
- (a) the receipt result bytes for stdout `true` parse with `serde_json::from_slice::<bool>`;
- (b) `NEAR_PREDECESSOR_ID` equals the calling account;
- (c) an HTTPS GET succeeds under `wasm32-wasip2`;
- (d) whether an execution whose `secrets_ref` names an absent profile runs or fails.

**Stop condition:** if (a), (b) or (c) fails, stop and revise this design. If (d) fails, the operator stores a placeholder profile `default` (`{"GATEFLOW_UNUSED":"1"}`, accessor = the project) before any screening. The `mainnet-launch` runbook gains that step.

**9. End of this change: a direct-call check, not a contract.**
- A testnet build with `GATEFLOW_CONTRACT=<test account>` is uploaded and deployed as project `<test account>/gateflow`.
- That account calls `request_execution` with real `screen` and `screen_intents` requests, and the verdicts match the spec: `false` for a named payer, `true` for a clean `0x…` payer, and `false` for an unknown deposit address.
- A second account gets `null`.
- Deploying a testnet contract and pointing it at the enclave stays in `mainnet-launch` 0.1, where `new(...)` takes the enclave setting.

## Risks / Trade-offs

- [The project owner can deploy a new active version, because the contract runs `version_key: null`] → This is the same trust as decision "A malicious enclave set by the operator" in `contract-from-scratch`: it can flip verdicts, never redirect funds. Publish the wasm SHA256 next to the source commit.
- [A secret named `NEAR_PREDECESSOR_ID` overrides the system variable] → Only whoever controls the `default` profile of `secrets_owner` (the operator) could set it, and it only affects executions that account itself triggers. Spike (d) records whether overriding is possible.
- [Unbounded instructions or memory: a huge `/v0/tokens` reply or a BTC tx with thousands of inputs exceeds limits and fails the execution] → Fuel is credited back once per failed run, and each run needs a paid 1Click delivery. Bodies above 2 MB are rejected as `None` before parsing.
- [GoPlus adds a severe flag the table does not know] → It scores 0, so the failure is open for that flag only. Tests pin the known field names, and the table is revisited with each enclave version.
- [GoPlus, Blockchair free tier, Blockstream or GitHub raw are rate-limited or down] → `false`, and the payment is refunded. Accepted, as in `screen-cross-chain-payer`.
- [Fixtures are hand-written, not recorded] → They can drift from the real shapes. The spike and `mainnet-launch` 2.1 swap in live captures, and the direct-call check (decision 9) exercises the real APIs.

## Migration Plan

1. Spike (decision 8). Proceed only if (a)–(c) hold.
2. `cargo test`, then `GATEFLOW_CONTRACT=<account> cargo build --target wasm32-wasip2 --release` per network.
3. Testnet: `outlayer upload`, then `outlayer deploy gateflow <url>`, then the direct-call check (decision 9).
4. Mainnet happens in `mainnet-launch` 1.2, which this change rewrites to the build, upload and deploy steps. `set_enclave` is needed only if the project differs from the one given at `new(...)`.
5. Rollback: `outlayer deploy` the previous wasm URL to reactivate it. The contract is unaffected.

## Open Questions

- None. Resolved in task 1.2: GoPlus returns flags as strings `"0"`/`"1"` (the parser accepts numbers too), and `data_source` is a free-form string.
