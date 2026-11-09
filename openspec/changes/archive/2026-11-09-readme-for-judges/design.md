# Design

## Context

See proposal.md, Why. Facts checked on 2026-11-09 that the new README must match:

- `gateflow.near` has one `FullAccess` key (`view_access_key_list`). `mainnet-launch` 1.1 records that the owner kept it.
- Payments 0–12 on `gateflow.near` are all `Settled` USDC delivered by `intents.near`. 1Click `/v0/status` gives the origin of each: payments 0–11 came from Arbitrum USDC, starting with payment 0 for invoice 0, and payment 12 came from Solana USDC (invoice 46, Solana tx `2MGSRAMJ…XMiP`, OutLayer job `1326858`).
- No nBTC, ZEC or NEAR-direct payment and no refund has run on mainnet. The owner chose to say so rather than run them.
- The Fly app has `LLM_API_KEY` set, and `fly.toml` sets `LLM_MODEL = "z-ai/glm-5.3-flash"`. So the assistant is configured in production. A working chat on mainnet is not recorded anywhere.
- The active enclave version is `bceb9c0b…` (`enclave/README.md`). The repo's first commit is 2026-11-01. The license is MIT.
- Dependencies:
  - contract: `near-sdk` 5
  - enclave: `serde` and `serde_json` only
  - relay: none (Node built-ins)
  - web: React, `@near-wallet-selector/*`, `lucide`, `qrcode`, Vite and Vitest
  - `examples/shop`: none
- The landing now shows NEAR, Ethereum, Solana, Bitcoin and Zcash. Base and Arbitrum still work.

## Goals / Non-Goals

**Goals:**
- Every factual sentence in the README can be checked from the repo or with a public mainnet call. The README gives the call wherever one exists.
- An AI screener can find, in the first screen of text, what the product is, the live URLs and how to verify it.
- A coding agent can start work from `AGENTS.md` alone.

**Non-Goals:**
- Marketing copy, badges or screenshots.
- Rewriting `enclave/README.md` or `web/README.md`.
- New verification tooling or a keyless demo mode.

## Decisions

**README order: what it is, try it, verify it, how it works, then details.** The screener reads top-down and stops early, so the claims and their proofs come before the long sequence diagram.

```
# Gateflow                       problem, product, NEAR's role (one paragraph)
                                 Live: console | demo shop. Built for: <tracks>
## Try it                        do X -> see Y, on mainnet, 0.01 USDC
## Verify on mainnet             curl RPC/1Click commands + expected output
## How NEAR is used              Intents 1Click, NEP-366, function-call key,
                                 OutLayer TEE, NEAR AI Cloud, named accounts
## How it works                  existing mermaid diagram + invariants (fixed)
## Modules
## Build and test                commands + expected "test result: ok" lines
## Run locally                   short; full env table -> relay/README.md
## Accept payments on your site  kept (API, widget, webhook)
## Status                        dated; verified vs unit-tested-only, per origin
## Disclosures                   Q-002, Q-003, Q-005, Q-015
## Roadmap                       + delete contract key; BYOK reworded
```

Alternative: keep the current order and add sections. Rejected, because the first screen would still be protocol internals.

**Verification uses plain `curl` against public endpoints.** No `near` CLI or wallet is needed. Mainnet RPC `call_function` gets `get_payment`, `get_invoice` and `get_tokens`, and `view_access_key_list` reads keys. `GET https://1click.chaindefuser.com/v0/status?depositAddress=…` gives the origin chain, and `https://gateflow.fly.dev/checkout/invoice?id=46` gives the screening record and wasm hash. Each command shows the expected key fields. Base64 args are given precomputed, so a reader can paste each command as it is.

**Status is a table per payer origin.** Columns: origin, path, mainnet evidence, tests.

| Origin | Mainnet | Evidence |
|---|---|---|
| Arbitrum USDC | settled | payments 0–11, invoice 0 first |
| Solana USDC | settled | payment 12, invoice 46, job 1326858 |
| Base / Ethereum USDC | not yet | unit tests only |
| Bitcoin, Zcash | not yet | unit tests only |
| NEAR direct | not yet | unit tests only |

The assistant row says "configured on the mainnet relay (`z-ai/glm-5.3-flash`, NEAR AI Cloud)", and claims a working chat only if apply-time evidence exists.

**Contract trust is stated as it is.** The README says the operator still holds a full-access key on `gateflow.near`, so the code can change until the key is deleted, and gives the `view_access_key_list` call. The contract's own rules (tokens leave only to `payout_to` or `refund_to`) stay as code-level invariants and are labeled as such. The Roadmap gains "Delete the contract's full-access key", and BYOK no longer says the contract has no upgrade path.

**`AGENTS.md` is the single agent file. `CLAUDE.md` is exactly `@AGENTS.md`.** Claude Code follows the import. Codex and other agents read `AGENTS.md` directly. Content: one-line purpose, a module map with entry points, test and build commands per module, the OpenSpec workflow (changes under `openspec/changes/`, specs under `openspec/specs/`, `/opsx:*` commands), conventional commits, and the hard rules. The hard rules:
- the relay uses Node built-ins only;
- the enclave reads no secrets, with the caller fixed at build;
- never commit `.env` or keys;
- never run a local relay with the mainnet `.env` while Fly is up;
- mainnet deploys, key changes and payments need the owner.

Alternative: two full files. Rejected because they drift.

**The env table moves verbatim to `relay/README.md` § Configuration.** The root keeps the three required variables and a link. That shortens the root by about 25 lines and keeps the details where the relay is documented.

**Disclosures text** (owner-confirmed):
- Built during NEAR HACKATHON: the first commit is 2026-11-01, so there is no pre-hackathon code (Q-003).
- No existing product on another chain (Q-002).
- No other project by this team (Q-015).
- Built with Claude Code and OpenSpec. The `openspec/changes/archive/` history holds every proposal, design and task list (Q-005).
- Libraries: as listed in Context.

## Risks / Trade-offs

- [Claims drift again before judging (new payments, key deletion)] → Status carries a date. Tasks re-run the verify commands as the last step.
- [Curl commands break if an endpoint changes] → Each command is run at apply time and its real output pasted as the expected result.
- [The screener expects a hosted demo it can use for free] → "Try it" says the merchant side is free and that paying needs 0.01 USDC on Arbitrum or Solana. The verify section lets a screener check without paying.
- [Listing BTC and ZEC as supported without mainnet proof reads as overclaiming] → They sit under "supported, unit-tested, not yet run on mainnet", never under "verified".

## Open Questions

- Tracks to name in the opening line. The default is realworld (main), security and privacy. The owner confirms at apply time, and this changes only one line.
- The demo post or video URL. It is added only if one exists at apply time; no placeholder is used.
