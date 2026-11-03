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
| Contract (`GATEFLOW_CONTRACT`) | `gateflow.near` |
| Project | `ops.gateflow.near/gateflow` |
| Source commit | `fb0e1c5` (enclave source unchanged since `80bec9e`) |
| wasm SHA256 | `11a4efa612d4c52ecad82827035968f34f7bc840d2b1fea28a70715f2ee6dabe` |
| FastFS URL | `https://main.fastfs.io/ops.gateflow.near/outlayer.near/11a4efa612d4c52ecad82827035968f34f7bc840d2b1fea28a70715f2ee6dabe.wasm` |
| Upload tx | not captured |

Direct-call checks, run on 2026-11-03 against `outlayer.near` before the contract code was deployed:

| Caller | Request | Result | Tx |
|---|---|---|---|
| `gateflow.near` | `screen` `alice.near` | `false` | `CaaCSbGXzn4ReQotS2oLwNt2Fdc7PcC8K3y5TwWoV8F7` |
| `gateflow.near` | `screen` `0xd8da6bf26964af9d7eed9e03e53415d37aa96045` | `true` | `4e9WUscwEZJ4V87JKR9VDHctY5otTxXCCte3nY3cYn1o` |
| `gateflow.near` | `screen` `0x098b716b8aaf21512996dc57eb0615e2383e2f96` (OFAC SDN) | `false` | `5zMb4xEuGYpqZvcJq6hoYBysYqJbEVNs5SW3DUvRNbAc` |
| `gateflow.near` | `screen_intents` with an unknown deposit address | `false` | `FAwDYoBhktcJNep45SMZYJF5C9QtFa8a9KJGGAMEL76Y` |
| `ops.gateflow.near` (second caller) | `screen` `alice.near` | `null` | `ELcwQKpSzYsVTCbdcuMgWCLo9NZzZECbxcwPQg7otZQR` |

The earlier deployment for `gateflow.greatbank5653.near` (project `greatbank5653.near/gateflow`, wasm `93c88fe3…1e41`, upload tx `8dNNZYsAsn3ZyWyZSGUbEGuwoyF7zVMUVDkoWGhGcJCj`) was retired on 2026-11-03 with that contract account.

## Testnet

Not deployed. On 2026-11-03, `test.fastfs.io` returned 502, so OutLayer testnet workers could not fetch any newly uploaded wasm ([out-layer/outlayer#32](https://github.com/out-layer/outlayer/issues/32)).

## Execution attestations

Checked on 2026-11-03. OutLayer's on-chain `request_id` (in the `execution_requested` event) is not the id its dashboard uses. Each execution also has a coordinator `job_id`, and the attestation is keyed by that:

- Attestation page: `https://app.outlayer.ai/attestation/<job_id>?network=mainnet`
- Raw attestation JSON (TDX quote, wasm, input and output hashes): `https://api.outlayer.ai/attestations/<job_id>`
- `request_id` or tx hash to `job_id`: `GET https://api.outlayer.ai/public/jobs?project=ops.gateflow.near/gateflow&user_account_id=<tx signer>&limit=50`, then match `transaction_hash` or `request_id`. Contract-run screenings are listed under the tx signer, for example `relay.gateflow.near` for `screen_intents`.

None of these API endpoints are documented by OutLayer. The checkout and console link to `https://app.outlayer.ai/executions` and show the `request_id`.

Example: request 2796, tx `C8UdBVpFo4kNQUU1tWivMeSKGkU3SYu5DNADuQCi35RS`, job 1255332, attestation `https://app.outlayer.ai/attestation/1255332?network=mainnet` (wasm `11a4efa6…dabe`).
