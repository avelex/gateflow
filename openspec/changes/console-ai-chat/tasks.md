# Console AI Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. OpenSpec tracks only the `- [ ] N.M` lines; the numbered steps under each task are its TDD cycle and are not tracked separately.

**Goal:** Turn on the console assistant. It is a tool-calling chat on NEAR AI Cloud that answers from the merchant's own data and proposes changes as confirm cards. Only the merchant's Confirm click and passkey execute those changes.

**Architecture:**
- `relay/src/chat.ts` runs a bounded tool loop against an OpenAI-compatible endpoint, using plain `fetch`.
- Read tools call the same contract views as the console routes.
- Write tools store a validated `chat_actions` row. Execution goes through the existing relayer, which now also requires the delegate to match the stored action exactly and claims the action once.
- The web app adds a chat view, typed cards, Recents and the entry points into chat.

**Tech Stack:** Node 26 built-ins with `node --test` (`relay/`). React, Vitest and the existing design-system components in `web/src/ds.jsx` (`web/`).

**Spec:**
- `openspec/changes/console-ai-chat/specs/{console-assistant,merchant-console}/spec.md`
- `openspec/changes/console-ai-chat/design.md`

## Global Constraints

- **Builds on the current code** (see the design's Context):
  - relay: `db.ts`, `Config`/`Deps`/`testing.ts`, the `console.ts` helpers (`requireGateway`, `readGateway`, `newestFirst`, `withMeta`, `tokenMeta`), `delegate.ts`;
  - web: `acquireKey`/`signAndRelay`/`invoiceArgs` in `console/logic.ts`, `parseAmount`/`formatAmount`, `ds.jsx`, the console screens.
- **Env:**
  - `LLM_BASE_URL` (default `https://cloud-api.near.ai/v1`)
  - `LLM_API_KEY` (required, otherwise 503 "assistant not configured")
  - `LLM_MODEL` (no default)
  - `CHAT_DAILY_LIMIT` (default 200)
- **Loop limits:** at most 6 tool rounds per message. At most 30 replayed messages, each with a user or assistant role, text only. No `strict` on tool schemas.
- **Read tools:**
  - `list_invoices({status?: "open"|"paying"|"paid"|"returned"|"expired"})`
  - `get_invoice({id})`
  - `list_payments({status?: "pending"|"settled"|"refunded"|"failed"})`
  - `get_payment({id})`
  - `settled_totals({period: "today"|"7d"|"30d"})`
  - `accepted_tokens({})`
  - `gateway_settings({})`
- **Write tools:**
  - `create_invoice({token, amount, expires_in, memo?})`, where `expires_in` is in hours, 1 to 720.
  - `set_risk_tolerance({max_risk})`, from 0 to 80.
  - `retry_payment({id})`.
- **Card payloads:** `{type:"invoice",invoiceId} | {type:"status",invoiceId} | {type:"confirm",actionId}`.
- **Fixed copy:**
  - Model failure: "The assistant is unavailable right now".
  - Trace: "Used " followed by tool groups ("invoices", "payments", "totals", "tokens", "settings") joined by ", ".
  - Chat footer: "Gateflow can be wrong. Nothing changes until you confirm with your passkey."
- **Commits:** short conventional style, one per task.

## Review Focus

- **The model proposes an invoice in a token the merchant switched off:** the tool returns an error and no action is stored. Test `create_invoice_disabled_token_rejected` (1.3).
- **The model asks for an invoice or payment id from another gateway:** the tool says not found. Tests `get_invoice_foreign_not_found` and `get_payment_foreign_not_found` (1.2).
- **A tampered confirm, where the browser posts a delegate for the action with a different amount:** 403 and the action stays pending. Test `relay_action_args_mismatch_refused` (1.5).
- **Double Confirm, two requests racing for the same action:** exactly one executes and the other gets 409. Test `action_claimed_once` (1.5).
- **The model sends malformed JSON tool arguments:** the error goes back to the model and the loop continues. Test `malformed_tool_args_reported` (1.4).

---

## 1. Assistant backend

- [x] 1.1 Add the chat tables and the model client, and pick the model. Verify that `cd relay && node --test src/*.test.ts` passes `chat_tables_roundtrip` and `complete_sends_tools_without_strict`. Also verify that `curl -s $LLM_BASE_URL/model/list -H "Authorization: Bearer $LLM_API_KEY"` lists the model written to `LLM_MODEL` in the README env table.
  1. Add `llmBaseUrl`, `llmApiKey`, `llmModel` and `chatDailyLimit` to `Config`/`loadConfig` in `relay/src/types.ts`. Add an optional `llm` port to `Deps`, built in `main.ts` only when `LLM_API_KEY` is set, and add a scripted fake to `testing.ts`.
  2. In `relay/src/db.ts`, add the three tables from design decision 3 with prepared helpers:
     - `createThread`, `threadsOf(email, limit)`, `thread(id, email)`
     - `addMessage`, `messages(threadId, limit)`, `userMessagesSince(email, sinceSec)`
     - `addAction`, `action(id, email)`, `claimAction(id): boolean`, `finishAction(id, status, result)`
  3. In `relay/src/chat.ts`, export `complete(messages, tools): Promise<{ content?: string; toolCalls?: { id: string; name: string; arguments: string }[] }>`, which POSTs `${LLM_BASE_URL}/chat/completions` with `{model, messages, tools}`. Test it with a stubbed `fetch`.
  4. Commit `feat(relay): chat storage and model client`.
- [x] 1.2 Add the read tools, scoped to the merchant. Verify that `node --test` passes `list_invoices_expired_filter`, `get_invoice_foreign_not_found`, `get_payment_foreign_not_found`, `settled_totals_periods` and `gateway_settings_shape`.
  1. In `chat.ts`, export `readTools(deps)`, which returns handlers `(args, merchant) => Promise<unknown>`. Export `readGateway`, `newestFirst` and `withMeta` from `console.ts` and reuse them, together with `tokenMeta`. Single items come from the contract views `get_invoice` and `get_payment`, checked against the merchant's `gateway_id`. Tests use `fakeNear` view tables.
  2. `settled_totals` follows design decision 9.
  3. Results use decimal amounts with symbols, and statuses are lowercase. Foreign ids return `{ error: "not found" }`.
  4. Commit `feat(relay): assistant read tools`.
- [x] 1.3 Add the write proposals. Verify that `node --test` passes:
  - `create_invoice_proposal_normalized`: "0.01" nBTC with 8 decimals gives the raw `"1000000"`, and 1 hour gives `expires_in_sec` 3600.
  - `create_invoice_too_precise_rejected`
  - `create_invoice_memo_too_long_rejected`
  - `create_invoice_disabled_token_rejected`
  - `risk_out_of_range_rejected`
  - `retry_not_failed_rejected`
  1. In `chat.ts`, export `writeTools(deps)`. Each handler validates its input, calls `db.addAction`, and returns `{ actionId, summary }`. The summary is, for example, `"Create invoice 0.01 nBTC, expires in 1 hour"`. Errors return `{ error }`.
  2. Put a node-side `parseAmount(text, decimals): bigint` in `relay/src/checkout.ts` that mirrors the web version.
  3. Commit `feat(relay): assistant write proposals`.
- [x] 1.4 Add the assistant loop and `POST /console/chat`. Verify that `node --test` passes `loop_stops_after_six_rounds`, `malformed_tool_args_reported`, `model_error_returns_unavailable`, `daily_limit_429`, `chat_not_configured_503`, `foreign_thread_404`, `trace_groups_tools` and `confirm_card_attached_for_proposal`.
  1. Export `runAssistant(ports, merchant, history, message): Promise<{ text: string; trace: string[]; cards: Card[] }>`, following design decision 2.
  2. Write the system prompt from design decision 6 as a constant.
  3. The route creates the thread when needed, checks the limit, stores the user and assistant messages, and returns `{ threadId, messages }`.
  4. Add `GET /console/threads` and `GET /console/threads/:id`.
  5. Commit `feat(relay): assistant loop and chat routes`.
- [x] 1.5 Bind confirmed actions to execution. Verify that `node --test` passes `decoded_function_call_has_args`, `relay_action_args_match_executes`, `relay_action_args_mismatch_refused`, `action_claimed_once`, `retry_action_confirm_uses_operator`, `dismiss_sets_dismissed`, `failed_tx_marks_failed` and `outcome_message_appended`.
  1. In `delegate.ts`, keep the args bytes that `readAction` currently skips: `DecodedAction` `functionCall` gains `args: Uint8Array`.
  2. `POST /console/relay` accepts an optional `actionId`. It decodes the delegate, requires exactly one function call whose method and args deep-equal the action params (403 otherwise), and calls `claimAction` (409 when it returns false) before submitting.
  3. Add `GET /console/actions/:id`, `POST /console/actions/:id/confirm` (retry only, with the checks of `POST /console/retry`) and `POST /console/actions/:id/dismiss`.
  4. On success, append an assistant message with the outcome text and card.
  5. Commit `feat(relay): confirm-bound assistant actions`.

## 2. Chat UI

- [x] 2.1 Add the chat view and cards. Verify that `cd web && npx vitest run src/console` passes `card_kind_mapping` and `trace_label`. Then verify manually against a fake-model relay (`LLM_BASE_URL` pointed at a local stub) that a thread shows user and assistant bubbles, the "Thinking…" row, the trace line, and the invoice and status cards in the design's style.
  1. Add a `/chat/<id>` route to `Route`/`route()` in `web/src/App.tsx`. `Console.tsx` renders the chat view for it.
  2. In `web/src/console/Chat.tsx`: a header with the thread title, the messages, the composer (Enter sends, Shift+Enter adds a newline) and the footer copy.
  3. In `web/src/console/cards.tsx`: `InvoiceCard` (with Copy payment link and Open checkout), `StatusCard` (with `FlowSteps`: Delivered, Screening, Released or Returned) and `ConfirmCard`. Each loads live data by id.
  4. Use static follow-up chips: the invoice card offers "What is the status of invoice #<id>?".
  5. Commit `feat(web): chat view and cards`.
- [ ] 2.2 Add confirm cards and the chat entry points. Verify on testnet with the real model:
  - Clicking "Create invoice for 0.01 BTC" on Home shows a confirm card with "0.01 nBTC" when nBTC is accepted. The testnet contract `gateflow-dev-v1.testnet` lists only `wrap.testnet`, so there the reply says BTC is not accepted, lists wNEAR and does not offer 0.01 wNEAR; "Create invoice for 0.01 NEAR" shows a confirm card with "0.01 wNEAR".
  - Confirm plus the passkey creates the invoice, and the card shows Done.
  - A second Confirm is not possible.
  - Dismiss shows Dismissed.
  - Recents lists the thread.
  - Cmd+K with no match plus Enter opens a new thread.
  - The Invoices "Ask about invoices" input opens chat.

  Steps:
  1. `ConfirmCard`: for `create_invoice` and `set_policy`, call `signAndRelay(await acquireKey(keyMode()), [{ method, args: params, gas: 30n * TGAS }], actionId)`. `signAndRelay` in `console/logic.ts` gains the optional `actionId` and posts it with the delegate. For `retry`, POST `/console/actions/:id/confirm`. Refresh the thread afterwards.
  2. Enable the Home composer and add the four hint chips.
  3. Add Recents to `Layout.tsx`, threads to `Search.tsx` (with Enter asking the assistant), and the ask input to `Invoices.tsx`.
  4. When the backend answers 503, show "Assistant not configured" in the composer.
  5. Commit `feat(web): assistant entry points and confirmations`.

## 3. Integration and docs

- [ ] 3.1 Run a live check against NEAR AI Cloud. With `LLM_BASE_URL` at its default and the chosen `LLM_MODEL`, send the four hint prompts plus "What is the status of invoice #<real id>?" on testnet. Verify that:
  - every reply uses tools, and its trace is shown;
  - the invoice prompt yields a confirm card with the right token and amount;
  - no reply claims an action happened before it was confirmed.
  Record the transcript summary in the PR description.
- [x] 3.2 Document the assistant in `README.md`: env vars, the default NEAR AI Cloud endpoint, the privacy note (private only on NEAR AI Cloud), the confirm-and-passkey guarantee, and the daily limit. Verify with `grep -n "LLM_BASE_URL\|LLM_API_KEY\|LLM_MODEL\|CHAT_DAILY_LIMIT" README.md`: all four are listed.

## Workflow follow-up

- `byok-screening-keys` also changes `merchant-console` (it adds the Screening providers requirement) and the sponsorship allowlist. The two changes do not conflict. Whichever change is archived second checks its `merchant-console` deltas against the updated main spec.
