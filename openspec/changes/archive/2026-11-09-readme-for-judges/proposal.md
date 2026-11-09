# Proposal

## Why

NEAR HACKATHON screens every submission with an AI agent (Claude Code or Codex) before humans judge it. The agent runs a reproducibility check and verifies each claimed feature. The rules ask for a README written for a machine reader: what the product is, the problem it solves, "do X, see Y" steps, and disclosures (Q-002, Q-003, Q-005, Q-015). The current README is accurate on the protocol, but it opens with internals, buries the live URLs, has no disclosures, and states things mainnet no longer matches. `gateflow.near` still has a full-access key, BTC, ZEC and Solana payments have now settled, and some Status lines are stale. The submission deadline is 2026-11-14T23:59Z.

## What Changes

- Rewrite `README.md` for a human reader and an AI screener:
  - A short opening: the problem, the product, and NEAR's role, plus live links (console, demo shop) and tracks.
  - A "Try it" section of "do X, see Y" steps on mainnet.
  - A "How NEAR is used" section.
  - Reproduce commands with their expected results.
  - A dated Status that separates what was verified on mainnet (with invoice, payment and tx evidence per origin: NEAR, EVM, Solana, Bitcoin, Zcash) from what was not.
  - A Disclosures section: hackathon-only history, no product on other chains, no other project, built with Claude Code and OpenSpec, and the libraries used.
  - The payment-flow diagram and invariants stay.
- Correct every false or stale claim:
  - The contract account holds a full-access key, so it is upgradable until the key is deleted. Key deletion moves to the Roadmap, and the BYOK roadmap item is reworded to match.
  - The payer networks gain Solana, screened by OFAC.
  - Stale lines go: `GOAL.md`, "the model is not chosen yet" (unless still true), and "BTC and ZEC payments are not yet run".
- Move the full environment-variable table and the run details from the root README to `relay/README.md`. The root keeps a short run section and links there.
- Add `AGENTS.md` for coding agents: the module map, build and test commands per module, the OpenSpec workflow, the commit style, and the hard rules (relay on Node built-ins only, the enclave reads no secrets, no secrets in commits, mainnet actions need the owner).
- Add `CLAUDE.md` holding only `@AGENTS.md`, so the two cannot drift.

## Capabilities

### New Capabilities

None. This is a documentation change with no behavior change (`skip_specs: true`).

### Modified Capabilities

None.

## Impact

- Files: `README.md` (rewritten), `relay/README.md` (gains the env table), and new files `AGENTS.md` and `CLAUDE.md`.
- No code, contract, enclave or deployment changes.
- Evidence comes from public mainnet views (`get_invoice` and `get_payment` on `gateflow.near`, 1Click `/v0/status`, OutLayer attestations) and from records already in `relay/README.md` and `openspec/changes/mainnet-launch/tasks.md`.
- Out of scope: a demo mode with fakes for keyless local runs (new code), deleting the contract key (owner's decision, kept for now), the X demo post and video (the human's job), and making the repository public (the human's decision, required by 2026-11-14).
