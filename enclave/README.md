# Gateflow enclave

The OutLayer guest that screens Gateflow payments. It reads one request from stdin and prints `true`, `false` or `null`. It holds no secrets, and the Gateflow contract account is fixed at build time: any other caller gets `null`.

## Build

The contract account is compiled in, so you build once per network:

```sh
cargo test
GATEFLOW_CONTRACT=<gateflow contract account> cargo build --target wasm32-wasip2 --release
shasum -a 256 target/wasm32-wasip2/release/gateflow-enclave.wasm
```

The toolchain is pinned to Rust 1.86.0 in `rust-toolchain.toml`.

## Deploy

Run these as the account named in the contract's `enclave.secrets_owner`:

```sh
outlayer login                     # pick the network
outlayer upload target/wasm32-wasip2/release/gateflow-enclave.wasm
outlayer deploy gateflow <FastFS URL printed by upload>
```

`deploy` creates the project `<owner>/gateflow`, or adds a new version to it, and activates that version. To roll back, run `outlayer deploy` with the previous wasm URL.

## Calling it

Callers must write out `resource_limits` in full. With `{}`, the OutLayer worker never picks up the request, and the yield times out after 200 blocks with `Execution promise failed` ([out-layer/outlayer#31](https://github.com/out-layer/outlayer/issues/31)). The contract sends:

```json
{"max_instructions":1000000000,"max_memory_mb":128,"max_execution_seconds":60}
```

`estimate_execution_cost` for these limits is 0.0070001 NEAR. A real run costs about 0.0011 NEAR. A `secrets_ref` that names a profile nobody stored does not fail the run.

## Mainnet

| | |
|---|---|
| Contract (`GATEFLOW_CONTRACT`) | `gateflow.greatbank5653.near` |
| Project | `greatbank5653.near/gateflow` |
| Source commit | `80bec9e` |
| wasm SHA256 | `93c88fe3981bc71c824d53180f9145d361a0fc89b31150d13cdee6efb7d11e41` |
| FastFS URL | `https://main.fastfs.io/greatbank5653.near/outlayer.near/93c88fe3981bc71c824d53180f9145d361a0fc89b31150d13cdee6efb7d11e41.wasm` |
| Upload tx | `8dNNZYsAsn3ZyWyZSGUbEGuwoyF7zVMUVDkoWGhGcJCj` |

Direct-call checks, run on 2026-11-03 against `outlayer.near` before the contract code was deployed:

| Caller | Request | Result | Tx |
|---|---|---|---|
| `gateflow.greatbank5653.near` | `screen` `alice.near` | `false` | `9bkPJ5eQrPXquiKFkfCRTb7kvGWgnivSydZax5VjJfpT` |
| `gateflow.greatbank5653.near` | `screen` `0xd8da6bf26964af9d7eed9e03e53415d37aa96045` | `true` | `2dQ974BhGhXm4XWntnx9ycvyA5GX41wbc1nuvrDXkorK` |
| `gateflow.greatbank5653.near` | `screen` `0x098b716b8aaf21512996dc57eb0615e2383e2f96` (OFAC SDN) | `false` | `5ScQa33sEZmbfYc64EMwXyG4Z8g8moEMhGR1USndUJvS` |
| `gateflow.greatbank5653.near` | `screen_intents` with an unknown deposit address | `false` | `2Nw5XkbpcCe99utnhsQnExNXz3tNKDdjLn33pcNdWYTy` |
| `greatbank5653.near` (second caller) | `screen` `alice.near` | `null` | `BNQZasgeEiVSYqM4aNjmSNp6RbPCWDJfu1M52K6wJDo9` |

## Testnet

Not deployed. On 2026-11-03, `test.fastfs.io` returned 502, so OutLayer testnet workers could not fetch any newly uploaded wasm ([out-layer/outlayer#32](https://github.com/out-layer/outlayer/issues/32)).
