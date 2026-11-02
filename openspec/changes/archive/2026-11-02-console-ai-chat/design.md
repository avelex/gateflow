# Design

## Context

Motivation: see proposal.md. Requirements: `specs/console-assistant/spec.md` and `specs/merchant-console/spec.md`.

This change builds on the current code:
- **Relay:**
  - `node:sqlite` in `db.ts`;
  - `loadConfig` and the injected `Deps` (`near`, `oneclick`, `db`) in `types.ts`, with fakes in `testing.ts`;
  - in `console.ts`: cookie sessions, `requireGateway`, `readGateway` (which tops up fuel), `newestFirst`, `withMeta`, `tokenMeta` and the operator `retry` checks;
  - in `delegate.ts`: `decodeSignedDelegate` and the `refusal` allowlist. The decoder currently skips function-call args.
- **Web:**
  - `acquireKey(keyMode())` gives one passkey prompt in either key mode (PRF or stored), and `signAndRelay(key, actions)` posts `/console/relay`. Both are in `web/src/console/logic.ts`.
  - The design-system components are in `web/src/ds.jsx`. `formatAmount`/`parseAmount` are in `web/src/format.ts`.
  - Home has a disabled composer. Invoices, Screening, Settings and Search exist.
  - Routes are in `App.tsx`.

The relay has no npm dependencies, so the model client is plain `fetch`.

NEAR AI Cloud serves OpenAI-compatible `/v1/chat/completions` with tool calling at `https://cloud-api.near.ai/v1`, and per-model direct endpoints run inside TEEs. Model ids are listed at `/v1/model/list`. Integrations report that the `strict` flag on tool schemas is not supported.

## Goals / Non-Goals

**Goals:**
- Any console action can be done from chat, with the same guarantee that only a Confirm click and a passkey change anything.
- Swap the provider by env only. NEAR AI Cloud is the default.

**Non-Goals:**
- Streaming responses, file attachments, exporting threads, model-generated follow-up suggestions.
- Verifying NEAR AI attestation in the console. That belongs to the privacy-track work.
- Letting the assistant read raw chain data or anything outside the merchant's own gateway.

## Decisions

**1. Non-streaming request and response.**
- `POST /console/chat` returns once the loop finishes. The UI shows the design's "Thinking…" row while it waits.
- *Alternative:* SSE streaming needs incremental rendering of tool traces and cards, which this change does not need. It can come later without changing the API shape: the same messages would arrive as events.

**2. The tool loop in `relay/src/chat.ts`.**
- `runAssistant(ports, merchant, history, message): Promise<AssistantTurn>` takes injectable ports `{ complete(messages, tools), tools: Record<name, (args, merchant) => Promise<unknown>> }`, so tests use a fake model.
- The model client is `Deps.llm`, the same pattern as `Deps.oneclick`: `main.ts` builds the `fetch` client, and `testing.ts` provides a scripted fake for route tests. It is absent when `LLM_API_KEY` is unset.
- Each round sends the messages and the tools. Each `tool_calls` entry runs, and its JSON result is appended as a `tool` message. The loop ends on a plain assistant message, or after 6 rounds.
- Malformed tool-argument JSON returns `{ error }` to the model instead of throwing.
- Tool schemas leave out `strict`.

**3. What gets stored and what is replayed.**
- Tables:
  - `chat_threads(id, email, title, created_at)`
  - `chat_messages(id, thread_id, role 'user'|'assistant', text, trace JSON, cards JSON, created_at)`
  - `chat_actions(id, thread_id, email, kind, params JSON, status 'pending'|'done'|'dismissed'|'failed', result JSON)`
- Only user and assistant text, plus one-line action outcomes ("Invoice #12 created"), is replayed to the model, at most 30 messages.
- Tool calls and results are not stored. The model calls tools again for fresh data, so the replayed context stays small and never goes stale.

**4. Cards are typed payloads.**
- `cards: ({ type: "invoice", invoiceId } | { type: "status", invoiceId } | { type: "confirm", actionId })[]`.
- The web side loads the current invoice, payment or action data when it renders a card. Cards in old threads therefore show live status.

**5. Write proposals are bound to execution.**
- A write tool validates its input and stores `chat_actions.params` in contract form:
  - `create_invoice {gateway, token, amount (raw string), expires_in_sec, memo?}`, with `memo` left out when it is empty, as `invoiceArgs` does.
  - `set_policy {gateway, policy: {max_risk}}`
  - `retry {payment}`
- It then returns `{ actionId, summary }` to the model, and the backend attaches a confirm card.
- On Confirm:
  - **Passkey actions:** the browser loads the action and calls `signAndRelay(await acquireKey(keyMode()), [{ method, args: params, gas }], actionId)`. The optional `actionId` is new and is posted with the delegate. `decodeSignedDelegate` now also returns each function call's args bytes. The relayer, besides its allowlist, requires that the delegate holds exactly one function call whose method and JSON-parsed args deep-equal the stored params. It also requires `UPDATE chat_actions SET status='done' WHERE id=? AND status='pending'` to change one row, or it answers 409. If the transaction fails, the status becomes `failed` with the 422 message.
  - **`retry`:** `POST /console/actions/:id/confirm` runs the operator `retry` with the same single-row status claim. It reuses the ownership and failed-status checks of `POST /console/retry`.
- `POST /console/actions/:id/dismiss` sets the status to `dismissed`.
- After success the backend appends an assistant message with the outcome card (the invoice card for `create_invoice`). This does not call the model.

**6. The system prompt is fixed in code.**
- It covers what Gateflow does: funds are held in the contract, the enclave screens the payer, then the payment is released or returned, and there are no merchant decisions.
- It covers the merchant's enabled tokens with their symbols and decimals, and today's UTC date.
- Rules:
  - Use tools for every fact.
  - Write tools only propose, so never say an action is done until its outcome appears.
  - Give amounts as decimal strings.
  - Refuse requests outside the Gateflow console.
- "BTC" is mapped to the nBTC token and "dollars" to USDC through the enabled token list given in the prompt.

**7. Model choice is env-only.**
- `LLM_BASE_URL` defaults to `https://cloud-api.near.ai/v1`. `LLM_API_KEY` is required for chat; without it, `POST /console/chat` answers 503 "assistant not configured" and the composer shows that state. `LLM_MODEL` has no default.
- The four values are added to `Config`/`loadConfig`.
- Task 1.1 picks a model that supports tool calling from `/v1/model/list` and records it in the README env table.

**8. Daily limit from stored messages.**
- The backend counts `role='user'` messages for the email since 00:00 UTC before calling the model. There is no separate counter table.

**9. Settled totals use the payment's open time.**
- The contract stores no settle time. `settled_totals` therefore sums `Settled` payments whose `opened_at_sec` falls in the period, measured in UTC.
- Home's `settledToday` uses the same rule on the local calendar day.

## Risks / Trade-offs

- **The model proposes a wrong amount or token.** → The confirm card shows normalized values from the token metadata ("0.01 nBTC"). Execution is tied to the stored params, so the merchant confirms exactly what will be signed.
- **Prompt injection through data.** → The only free text in tool results is merchant-written memos. Payer and refund ids follow the NEAR account charset. Even a successful injection can only propose, never execute.
- **Inference cost and abuse.** → The daily limit, 6 rounds per message, and 30 messages of replayed context.
- **No NEAR AI key at demo time.** → Any OpenAI-compatible endpoint works through env. The privacy claim then does not hold, which README states.
- **Tool calling differs between models.** → Tested against a fake model. Task 3.1 runs the real NEAR AI model on the four hint prompts before the change is called done.

## Migration Plan

1. Deploy the relay. The new tables are created with `CREATE TABLE IF NOT EXISTS` at startup.
2. Set `LLM_API_KEY` and `LLM_MODEL`, and optionally `LLM_BASE_URL` and `CHAT_DAILY_LIMIT`.
3. Rollback: unset `LLM_API_KEY`. The composer shows "Assistant not configured" and the other screens work unchanged.

## Open Questions

- Which NEAR AI Cloud model gives the most reliable tool calls for the cost. This is chosen in task 1.1 and only changes the `LLM_MODEL` value.
