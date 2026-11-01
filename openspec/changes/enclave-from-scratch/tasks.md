# Enclave From Scratch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. OpenSpec tracks only the `- [ ] N.M` lines; the numbered steps under each task are its TDD cycle and are not tracked separately.

**Goal:** Write the `enclave/` OutLayer guest that answers the contract's `screen` and `screen_intents` requests with `true`, `false` or `null`, as `payment-clearing` specifies.

**Architecture:**
- `enclave/src/lib.rs` holds every verdict rule as pure functions, plus two flows that take a `fetch` closure, so `cargo test` runs on the host with fixtures.
- `enclave/src/main.rs` is the only wasi-specific code: stdin, the caller check, `wasi-http-client`, and stdout.
- The configuration is compiled in, and no secrets are read.

**Tech Stack:** Rust (edition 2021), `wasm32-wasip2`, `serde` 1 + `serde_json` 1, `wasi-http-client` 0.2 (wasi target only), the `outlayer` CLI, and `near` CLI.

**Spec:**
- `openspec/specs/payment-clearing/spec.md`: the enclave requirements "Screened sender is the NEAR sender", "Only the configured enclave answers", "Deferred screening binds the 1Click deposit", "Deferred screening checks the origin senders", "Bitcoin senders…" and "Zcash senders…".
- `openspec/changes/enclave-from-scratch/specs/payment-clearing/spec.md`.
- `openspec/changes/enclave-from-scratch/design.md`.

## Global Constraints

- Request JSON exactly as the contract sends it:
  - `{"kind":"screen","payer":String,"max_risk":u8}`
  - `{"kind":"screen_intents","deposit_address":String,"invoice":u64,"ref":String,"amount":String,"max_risk":u8}`
  - Rust field `reference` with `#[serde(rename = "ref")]`.
- stdout is exactly `true`, `false` or `null`, followed by `flush()`. Nothing else ever goes to stdout.
- No `unwrap`, `expect`, `panic!` or `[..]` indexing on request or fetched data anywhere in `enclave/src`. Tests may use them.
- `GATEFLOW_CONTRACT` is read only through `env!("GATEFLOW_CONTRACT")`. The only runtime env var read is `NEAR_PREDECESSOR_ID`.
- EVM RPCs:
  - `base` = `https://base-rpc.publicnode.com`
  - `eth` = `https://ethereum-rpc.publicnode.com`
  - `arb` = `https://arbitrum-one-rpc.publicnode.com`
- 1Click base: `https://1click.chaindefuser.com/v0`, with no API key header.
- GoPlus: `https://api.gopluslabs.io/api/v1/address_security/{addr}?chain_id=1`, with tiers exactly as in the delta spec ("GoPlus risk score").
- Esplora: `https://blockstream.info/api/tx/{hash}`. Blockchair: `https://api.blockchair.com/zcash/dashboards/transaction/{hash}`.
- OFAC: `https://raw.githubusercontent.com/0xB10C/ofac-sanctioned-digital-currency-addresses/lists/sanctioned_addresses_XBT.txt` and the same path with `_ZEC.txt`.
- Response bodies above 2 MB count as a failed fetch (`None`).
- `wasi-http-client` goes under `[target.'cfg(target_os = "wasi")'.dependencies]`, so the host `cargo test` builds without it.
- Release profile: the same as `contract/Cargo.toml` (`opt-level = "z"`, `lto = true`, `panic = "abort"`, `overflow-checks = true`).
- Build: `cd enclave && GATEFLOW_CONTRACT=<account> cargo build --target wasm32-wasip2 --release`.
- Commits: short conventional style, one per task.

## Review Focus

- Payer `0xABC…` in uppercase hex: it is not a valid NEAR account, and it must give `false` without a fetch. Test `uppercase_hex_payer_fails` (2.1).
- `customRecipientMsg` that is not JSON, or an `invoice` sent as a string `"0"`: must give `false`, not panic. Test `binding_rejects_bad_msg` (2.3).
- A BTC tx in which one input has no `scriptpubkey_address` (a non-standard script): must give `false`, not drop the input. Test `btc_input_without_address_fails` (2.2).
- `amountOut` equal in value but formatted differently (`"10000000"` vs `"1e7"`): exact string match, so it gives `false`. Test `binding_rejects_amount_format` (2.3).
- An OFAC list line with trailing whitespace or a CRLF: still matches. Test `ofac_trims_lines` (2.2).

---

## 1. Spike and fixtures

- [ ] 1.1 Run the OutLayer spike (design decision 8) with a throwaway guest in the scratchpad, not in `enclave/`. Verify (a)–(c) hold, and record (a)–(d) plus the explorer tx hashes as a "Spike results (date)" list under decision 8 in `design.md`
  1. In a scratch crate, `main` reads stdin. Input `pred` prints `NEAR_PREDECESSOR_ID` as a JSON string. Input `http` prints `true` when `GET https://1click.chaindefuser.com/v0/tokens` is 2xx, else `false`. Any other input prints `true`.
  2. `cargo build --target wasm32-wasip2 --release`. Then `outlayer upload` and `outlayer deploy gateflow-spike <url>` on testnet, under a test account.
  3. From that account, `near contract call-function as-transaction outlayer.testnet request_execution` with the design's call shape and `input_data` set to `"x"`, then `"pred"`, then `"http"`. The `secrets_ref` profile is `default` on an account that has no stored secrets.
  4. Results:
     - (a) the `x` run's receipt result decodes to exactly the bytes `true`;
     - (b) the `pred` run returns the calling account;
     - (c) the `http` run returns `true`;
     - (d) note whether any run failed with a secrets error.
  5. **Stop condition:** (a), (b) or (c) fails. Stop and revise the design with the user. If only (d) fails, the placeholder profile is added to task 5.2.
- [x] 1.2 Capture live fixtures into `enclave/tests/fixtures/` with `curl`, and hand-write the 1Click ones. Verify each `jq -e` check below exits 0
  - `goplus-clean.json`: any fresh EOA. `.code==1`
  - `goplus-severe.json`: the Ronin exploiter `0x098b716b8aaf21512996dc57eb0615e2383e2f96` (OFAC SDN; the Tornado Cash router is no longer flagged). `.result.sanctioned=="1"`
  - `goplus-low.json`: a copy of `goplus-clean.json` with only `blacklist_doubt` set
  - `evm-tx.json`: `eth_getTransactionByHash` for a recent Base USDC transfer. `.result.from`
  - `btc-tx.json`: any P2WPKH spend. `.vin[0].prevout.scriptpubkey_address`
  - `btc-coinbase.json`: the coinbase tx of any block. `.vin[0].is_coinbase`
  - `zec-transparent.json`: a t-to-t tx. The inputs' `recipient` values start with `t1`
  - `zec-shielded.json`: a z-to-t tx. `.data[].inputs|length==0`
  - `oneclick-tokens.json`: `/v0/tokens`. It has an entry with `blockchain=="base"`, one with `"btc"` and one with `"zec"`
  - `oneclick-status-success.json` and `oneclick-status-processing.json`: hand-written in the shape from the archived `screen-cross-chain-payer` design. `recipient` is `gateflow.test`, `customRecipientMsg` is `"{\"invoice\":0,\"ref\":\"r1\",\"refund_to\":\"bob.near\"}"`, `amountOut` is `"10000000"`, `originAsset` is the base USDC asset id from `oneclick-tokens.json`, and there is one `originChainTxHashes` entry with the hash from `evm-tx.json`
  - `ofac-xbt.txt` and `ofac-zec.txt`: the first 20 lines of each live list
  - Commit `test(enclave): add API fixtures`.

## 2. Pure verdict rules

- [x] 2.1 Create the crate, plus requests and GoPlus scoring. Verify `cd enclave && cargo test` passes these tests
  **Files:** `enclave/Cargo.toml`, `enclave/rust-toolchain.toml` (`channel = "1.86.0"`, `targets = ["wasm32-wasip2"]`), `enclave/.gitignore` (`target`), `enclave/src/lib.rs`, `enclave/src/request.rs`, `enclave/src/goplus.rs`.
  **Produces:**
  - `enum Request { Screen { payer: String, max_risk: u8 }, ScreenIntents { deposit_address: String, invoice: u64, reference: String, amount: String, max_risk: u8 } }` (serde, `tag = "kind"`, `rename_all = "snake_case"`)
  - `fn parse_request(stdin: &str) -> Option<Request>`
  - `fn is_evm_account(s: &str) -> bool` (`^0x[0-9a-f]{40}$`)
  - `fn goplus_url(addr: &str) -> String`
  - `fn goplus_score(body: &str) -> Option<u8>`. The flag value may be the string `"1"` or the number `1`.
  1. Tests:
     - `parses_both_kinds`: the two JSON literals from `contract/src/payments.rs:250` and `contract/src/screening.rs` tests.
     - `unknown_kind_is_none`.
     - `uppercase_hex_payer_fails`: `is_evm_account("0xABCDEF…")` is false; `alice.testnet` is false; a 64-hex implicit account is false.
     - `score_tiers`: the clean fixture gives `Some(0)`, low gives `Some(30)`, severe gives `Some(100)`, and an inline `mixer` gives `Some(70)`.
     - `malicious_contracts_count`: `number_of_malicious_contracts_created: "2"` gives `Some(70)`.
     - `goplus_error`: `{"code":2}` gives `None`.
  2. Run: FAIL. 3. Implement. 4. Run: PASS. 5. Commit `feat(enclave): parse requests and score GoPlus`.
- [x] 2.2 Sender resolvers, OFAC and `all_pass`. Verify `cargo test` passes these tests
  **Files:** `enclave/src/origin.rs`, `enclave/src/ofac.rs`.
  **Produces:**
  - `fn evm_rpc(chain: &str) -> Option<&'static str>`
  - `fn evm_tx_body(hash: &str) -> String` (the JSON-RPC request)
  - `fn evm_sender(body: &str) -> Option<String>` (lowercased)
  - `fn btc_senders(body: &str) -> Option<Vec<String>>`
  - `fn zec_senders(body: &str, hash: &str) -> Option<Vec<String>>`
  - `fn ofac_score(list: &str, addr: &str) -> u8`
  - `fn all_pass(scores: &[Option<u8>], max_risk: u8) -> bool`
  1. Tests:
     - `evm_from`: the fixture gives `.result.from`, lowercased.
     - `evm_null_result`: `{"result":null}` gives `None`.
     - `btc_inputs`: the fixture gives a list with one address per vin.
     - `btc_coinbase_has_no_sender`: `None`.
     - `btc_input_without_address_fails`: one vin without `scriptpubkey_address` gives `None`.
     - `zec_transparent`: the `t1…` list.
     - `zec_shielded_has_no_sender`: `None`.
     - `ofac_listed`: the first fixture line scores 100 and an unlisted address scores 0.
     - `ofac_trims_lines`: `"addr \r\n"` matches `addr`.
     - `all_pass`: `[]` is false, `[Some(0), None]` is false, `[Some(0), Some(100)]` with 50 is false, `[Some(30), Some(0)]` with 50 is true.
     - `evm_rpc`: `base`, `eth` and `arb` map to the constants, and `polygon` gives `None`.
  2. Run: FAIL. 3. Implement. 4. Run: PASS. 5. Commit `feat(enclave): resolve origin senders and OFAC scores`.
- [x] 2.3 1Click binding and origin chain. Verify `cargo test` passes these tests
  **Files:** `enclave/src/oneclick.rs`.
  **Produces:**
  - `fn status_url(deposit_address: &str) -> String` (deposit address percent-encoded)
  - `fn binding(body: &str, contract: &str, invoice: u64, reference: &str, amount: &str) -> bool`
  - `fn origin(body: &str, tokens: &str) -> Option<(String, Vec<String>)>`, which returns the `blockchain` and the origin tx hashes, and `None` for an empty hash list.
  1. Tests:
     - `binding_accepts_success`: the success fixture with `("gateflow.test", 0, "r1", "10000000")` gives true.
     - `binding_rejects_processing`: false.
     - `binding_rejects_wrong_ref`.
     - `binding_rejects_wrong_invoice`.
     - `binding_rejects_wrong_recipient`.
     - `binding_rejects_bad_msg`: the msg `"not json"` and the msg `{"invoice":"0","ref":"r1"}` both give false.
     - `binding_rejects_amount_format`: `"1e7"` gives false.
     - `origin_base`: the success fixture with the tokens fixture gives `("base", [hash])`.
     - `origin_unknown_asset`: `None`.
  2. Run: FAIL. 3. Implement. 4. Run: PASS. 5. Commit `feat(enclave): check the 1Click binding`.

## 3. Flows

- [x] 3.1 `screen` and `screen_intents` over a `fetch` closure. Verify `cargo test` passes these tests
  **Files:** `enclave/src/flows.rs`.
  **Consumes:** everything from 2.1–2.3.
  **Produces:**
  - `struct Http { method: &'static str, url: String, body: Option<String> }`
  - `fn verdict(req: Request, contract: &str, fetch: &dyn Fn(&Http) -> Option<String>) -> bool`, which dispatches to `screen` or `screen_intents` (design decisions 4 and 5).

  Each OFAC list is fetched at most once per call. Every request is a GET except the EVM JSON-RPC, which is a POST with a `content-type: application/json` header added by `main`.
  1. Tests use a fetch closure over a `HashMap<String, String>` of URL to fixture. It records the URLs it was called with and returns `None` for unknown URLs.
     - `named_payer_no_fetch`: `alice.testnet` gives false, with zero calls.
     - `clean_evm_payer`: `true`.
     - `severe_evm_payer`: false.
     - `goplus_down`: `None` from fetch gives false.
     - `intents_clean_base`: the success fixture with a clean GoPlus result gives true.
     - `intents_processing`: false, and no chain call is made.
     - `intents_unsupported_chain`: the tokens fixture edited so the asset's chain is `sol` gives false.
     - `two_txs_one_flagged`: false.
     - `btc_list_fetched_once`: a BTC origin with two txs gives exactly one `…_XBT.txt` call.
     - `chain_api_down`: Blockstream `None` gives false.
  2. Run: FAIL. 3. Implement. 4. Run: PASS. 5. Commit `feat(enclave): screen and screen_intents flows`.

## 4. Guest binary

- [ ] 4.1 The `main` caller check, HTTP and output. Verify `cargo test` passes, `GATEFLOW_CONTRACT=gateflow.test cargo build --target wasm32-wasip2 --release` succeeds, and the same build without the variable fails with an `env!` error
  **Files:** `enclave/src/lib.rs` (`pub fn run(stdin: &str, predecessor: Option<&str>, contract: &str, fetch) -> Option<bool>`), `enclave/src/main.rs`.
  **Consumes:** `parse_request` and `verdict`.
  - `run` behavior:
    - `predecessor != Some(contract)` gives `None`;
    - an unparseable request gives `Some(false)`;
    - otherwise `Some(verdict(..))`.
  - `main` under `cfg(target_os = "wasi")`:
    - reads all of stdin;
    - reads `NEAR_PREDECESSOR_ID`;
    - builds `fetch` on `wasi_http_client::Client` with a 20 s timeout, returning `None` on non-2xx, on an error, or on a body above 2 MB;
    - prints `true`, `false` or `null` and flushes.
  - On the host, `main` is an empty `fn main() {}`, so `cargo test` builds.
  1. Tests in `lib.rs`:
     - `foreign_caller_null`: `run(.., Some("evil.near"), "gateflow.test", ..)` gives `None`.
     - `missing_caller_null`.
     - `garbage_stdin_false`: `"{"` gives `Some(false)`.
     - `contract_caller_runs`: a named payer gives `Some(false)`.
  2. Run: FAIL. 3. Implement. 4. Run: PASS, plus both build checks. 5. Commit `feat(enclave): OutLayer guest entry point`.

## 5. Testnet and docs

- [ ] 5.1 Deploy to testnet and run the direct-call check (design decision 9). Verify that the five runs below give the expected verdicts, and record their tx hashes and the wasm SHA256 in `enclave/README.md`
  1. `GATEFLOW_CONTRACT=<test account> cargo build --target wasm32-wasip2 --release`, then `outlayer upload` and `outlayer deploy gateflow <url>` as `<test account>`.
  2. As `<test account>`, call `request_execution` with the design's call shape:
     - `screen` with `payer: "alice.testnet"` → `false`
     - `screen` with a clean `0x…` EOA → `true`
     - `screen` with `0x098b716b8aaf21512996dc57eb0615e2383e2f96` → `false`
     - `screen_intents` with `deposit_address: "0x0000000000000000000000000000000000000000"` → `false`
  3. As a second account, run the clean `screen` → `null`.
  4. Write `enclave/README.md`: what the guest does (pointing to the spec), build per network, the upload and deploy commands, and the recorded hashes. Commit `docs(enclave): testnet deployment`.
- [ ] 5.2 Audit and sync docs. Verify that `grep -nE '\.unwrap\(|\.expect\(|panic!|\[[0-9a-z_]+\]' enclave/src/{request,goplus,origin,ofac,oneclick,flows}.rs enclave/src/main.rs` prints nothing outside `#[cfg(test)]` modules, and that `openspec validate enclave-from-scratch --strict` passes
  - README: in the Modules row for `enclave/`, add "no secrets; caller fixed at build". In Status, say the enclave is implemented, unit-tested and deployed on testnet, and that `relay/`, `web/` and `GOAL.md` are not yet in this repository. Point the deploy notes link at `enclave/README.md` until `GOAL.md` returns.
  - `openspec/changes/mainnet-launch/tasks.md` 1.2 becomes: "Build the enclave with `GATEFLOW_CONTRACT=<mainnet gateflow account>`, then `outlayer upload` and `outlayer deploy gateflow <url>` as the account named in `enclave.secrets_owner`. Store the placeholder `default` profile only if `enclave-from-scratch` spike (d) required it. Then `set_enclave` if the project differs from `new(...)`. Verify that a direct NEAR test payment from a clean account reaches `Settled`."
  - Commit `docs: sync enclave status and mainnet runbook`.

## Workflow follow-up

- Run `/opsx:archive enclave-from-scratch` after review. This syncs the three added requirements into `openspec/specs/payment-clearing/spec.md`.
