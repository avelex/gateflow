# README for Judges Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A README that an AI screener can verify claim by claim, plus `AGENTS.md`/`CLAUDE.md` for coding agents.

**Architecture:** Docs only. Collect mainnet evidence first, then write the README around it, move the env table to `relay/README.md`, add the agent files, and finish with a claim audit.

**Tech Stack:** Markdown; `curl` against NEAR mainnet RPC, the 1Click API and `gateflow.fly.dev`.

**Spec:** `openspec/changes/readme-for-judges/{proposal.md,design.md}` (no delta specs: `skip_specs: true`)

## Global Constraints

- Every factual sentence is checkable from the repo or with a public call. Do not claim what has no evidence.
- No marketing: plain, short sentences in active voice. No badges, no emoji.
- Mainnet RPC: `https://rpc.mainnet.near.org`. Contract: `gateflow.near`. 1Click: `https://1click.chaindefuser.com/v0`. App: `https://gateflow.fly.dev`. Shop: `https://gateflow-shop.fly.dev`.
- Evidence and run date: 2026-11-09 (update it if you re-run on a later day).
- Verified on mainnet: Arbitrum USDC (payments 0–11; payment 0 is invoice 0) and Solana USDC (payment 12, invoice 46, Solana tx `2MGSRAMJmwZYsfpkLU84oro5ycUwK2MjRBAPFQTMY4f7g4ZHFThX2TuqHs46YYcdQCbsKgmjZHXFmJZJ63ZsXMiP`, OutLayer job `1326858`).
- Not yet on mainnet: Base, Ethereum, Bitcoin, Zcash, NEAR direct, and any refund. Say exactly that.
- Contract: `gateflow.near` has one FullAccess key, so it is upgradable until that key is deleted.
- Write no placeholders: no tracks or video URL unless the owner gives them.
- Commits: conventional style, short.

## Review Focus

- A README sentence still claiming "no access keys" or "no upgrade path" anywhere, including the BYOK item. Caught by 5.1.
- A verify command whose pasted output no longer matches a live run (base64 typo, endpoint change). Caught by 5.2.
- A relative link pointing at a moved or missing file (`openspec/changes/mainnet-launch/…`, `relay/README.md#…` anchors). Caught by 5.3.
- Chain lists that disagree between the README, the landing and the specs (Solana missing, or Base/Arbitrum dropped from "works"). Caught by 5.1.
- `CLAUDE.md` holding anything besides the import, which lets it drift from `AGENTS.md`. Caught by 4.2.

---

## 1. Evidence

- [x] 1.1 Run each verify command below and keep its raw output for Task 3:
  - `view_access_key_list` for `gateflow.near`: expect 1 key, `FullAccess`.
  - `call_function get_tokens`: expect USDC `17208628…33a1`, `nbtc.bridge.near` and `zec.omft.near`.
  - `call_function get_payment {"payment":0}` and `{"payment":12}`: expect `Settled`, payer `intents.near`.
  - 1Click `/v0/status?depositAddress=<payment 0 deposit_address>`: expect `SUCCESS` with an origin asset on `arb`.
  - `GET https://gateflow.fly.dev/checkout/invoice?id=46`: expect `status: Paid`, `screening.outcome: approved` and `wasmHash: bceb9c0b…`.
- [x] 1.2 Ask the owner for the tracks to name, and for a demo post or video URL if one exists. If they give none, write no tracks line and no video link.

## 2. relay/README.md configuration

**Files:** Modify `relay/README.md` (§ Run) and `README.md` (remove the env table).

- [x] 2.1 Move the env-variable table from the root `README.md` ("Run the app", 20 rows) into `relay/README.md` as `## Configuration`, right after `## Run`. Move the `npm run dev` proxy note with it.
- [x] 2.2 Check: `grep -c '^| `' relay/README.md` grew by 20, and the root README no longer has `| Variable | Default | Meaning |`.
- [x] 2.3 (Added at apply, owner-approved.) Make `web/src/App.test.ts` load under vitest. `web/src/checkout/Checkout.tsx:19` reads `location.search` when the module loads. Guard it with `typeof location === "undefined" ? "" : location.search`. Check: `cd web && npx vitest run` prints `Test Files  9 passed (9)`.

## 3. README rewrite

**Files:** Rewrite `README.md`, in the section order of design.md, Decisions.

- [x] 3.1 Write the opening paragraph:
  - Problem: taking crypto means running nodes, hot wallets, bridges and a compliance vendor.
  - Product: a payment link or API, screened in a TEE, paid out to the merchant's own NEAR account.
  - NEAR's role.
  - Then `Live:` with the console and demo shop links, and the tracks line from 1.2 if given.
- [x] 3.2 Write `## Try it` as numbered "do X, see Y" steps on `gateflow.fly.dev`:
  1. Sign in with an email and create a passkey; see console Home.
  2. Create a 0.01 USDC invoice; see the `/pay/<id>` link.
  3. Pay from Arbitrum or Solana USDC; see Paying, then Paid.
  4. Open the attestation link; see the TEE quote on OutLayer.
  - Add the shop alternative, ending with the webhook strip showing `invoice.paid`.
  - Say that the merchant side is free and paying costs 0.01 USDC.
- [x] 3.3 Write `## Verify on mainnet` with the five commands from 1.1, each with its precomputed `args_base64` and the expected fields copied from the 1.1 output.
- [x] 3.4 Write `## How NEAR is used`, one line each:
  - NEAR Intents 1Click: cross-chain deposits.
  - NEP-366 meta transactions: the merchant signs and the relay pays gas.
  - Function-call key: the invoice signer can only call `create_invoice`.
  - OutLayer TEE: screening, with attestations.
  - NEAR AI Cloud: the assistant's inference in a TEE.
  - Named accounts: `<label>.merchant.gateflow.near`.
- [x] 3.5 Keep the mermaid diagram and the invariants under `## How it works`:
  - Change the payer list to "an EVM chain (Base, Ethereum, Arbitrum), Solana, Bitcoin or Zcash".
  - Add Solana to the enclave's `alt` branches (signers, then OFAC SOL).
  - Replace the invariant "The contract account holds no access keys and has no upgrade path" with the FullAccess-key fact plus the code-level rule on where tokens can go.
- [x] 3.6 Keep `## Modules`, `## Build and test` (add each command's success line: `test result: ok` for cargo, `ℹ fail 0` for relay, `Tests  N passed` for vitest), `## Run locally` (short, linking `relay/README.md#configuration`), and `## Accept payments on your site` (unchanged).
- [x] 3.7 Write `## Status` (dated) as the per-origin table from design.md, plus the console, the merchant API and widget, and the assistant ("configured on the mainnet relay with `z-ai/glm-5.3-flash` on NEAR AI Cloud"). Delete the `GOAL.md`, "model is not chosen" and "BTC and ZEC payments are not yet run" lines.
- [x] 3.8 Write `## Disclosures` with the four items from design.md, and a libraries list per module.
- [x] 3.9 Update `## Roadmap`:
  - Add "Delete the contract's full-access key, which makes `gateflow.near` immutable".
  - Reword BYOK: it needs a contract upgrade, possible while the key exists, plus the fuel-credit fix.
  - Add GoPlus for Solana.

## 4. Agent files

**Files:** Create `AGENTS.md` and `CLAUDE.md`.

- [x] 4.1 Write `AGENTS.md` with:
  - A one-line purpose.
  - The module map (path, language, entry point: `contract/src/lib.rs`, `enclave/src/flows.rs`, `relay/src/main.ts`, `web/src/App.tsx`, `examples/shop/server.mjs`).
  - Test and build commands per module.
  - The OpenSpec workflow (`openspec/specs/` is current behavior, `openspec/changes/` is work in flight, `/opsx:explore|propose|apply|archive`).
  - The commit style.
  - The hard rules from design.md.
  - Pointers to `relay/README.md` and `enclave/README.md` for deploys.
  - Check that `web/src/App.tsx` exists before naming it; otherwise name the real entry.
- [x] 4.2 Write `CLAUDE.md` holding exactly one line, `@AGENTS.md`. Check: `cat CLAUDE.md` prints only that line.

## 5. Audit and commit

- [x] 5.1 Run `grep -nE 'no access keys|no upgrade path|GOAL\.md|not chosen|not yet run' README.md`; expect no match except the Roadmap key-deletion line. Run `grep -c Solana README.md`; expect at least 3.
- [x] 5.2 Re-run every command in `## Verify on mainnet`; each output must contain the fields the README lists.
- [x] 5.3 Check that every relative link in `README.md` and `AGENTS.md` resolves to an existing file. Check that each `#anchor` used matches a heading in its target.
- [x] 5.4 Commit: `docs: readme for judges, agents guide`.

## Workflow follow-up

- `/opsx:archive readme-for-judges` after review.
- The owner decides separately whether to make the repo public before 2026-11-14T23:59Z, and whether to post on X with the video.
