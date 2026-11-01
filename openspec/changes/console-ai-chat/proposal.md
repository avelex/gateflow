# Proposal

## Why

The console design is built around an assistant. The merchant asks "Generate invoice for 0.01 BTC" or "What is the status of invoice #123?" and gets answers and invoice cards in chat. `web-console-checkout` ships that composer disabled. This change turns it on as a natural-language way to run the same console actions, while keeping the existing guarantee that nothing changes on-chain without the merchant's passkey.

For the NEAR AI track, inference runs on NEAR AI Cloud, which serves OpenAI-compatible chat completions from TEEs. The merchant's payment data is therefore processed privately.

## What Changes

- **New `POST /console/chat`** in the backend. It runs a tool-calling loop against an OpenAI-compatible endpoint (`LLM_BASE_URL`, default `https://cloud-api.near.ai/v1`) and keeps threads and messages in SQLite.
- **Read tools** run without asking: list and get invoices, list and get payments, settled totals for a period, the accepted tokens, and the gateway settings (payout, risk tolerance, fuel readiness).
- **Write tools only propose.** `create_invoice`, `set_risk_tolerance` and `retry_payment` return a pending action that the backend validates and normalizes, for example a decimal amount converted to raw units with the token's decimals.
  - The console renders the action as a confirm card showing the exact values.
  - Only the merchant's Confirm click executes it. That click triggers the passkey prompt and the existing relayer; `retry_payment` needs no passkey.
  - The LLM never executes or signs anything.
- **Chat UI from the design:**
  - Home composer with hint chips; the chat view with user and assistant messages and a "Used …" trace line;
  - invoice, status and confirm cards, with static follow-up chips;
  - Recents in the sidebar;
  - Invoices-screen "Ask about invoices" input that opens a thread.
- **Limits.** Each merchant gets `CHAT_DAILY_LIMIT` messages per day (default 200). The loop runs at most 6 tool rounds per message. The last 30 messages of a thread are sent to the model as context.

## Capabilities

### New Capabilities
- `console-assistant`: chat threads, the model endpoint, read tools, write proposals with confirm cards, and limits.

### Modified Capabilities
- `merchant-console`: Home's composer is enabled with hints, the sidebar lists recent chats, and Search also finds chats. These requirements are introduced by `web-console-checkout`.

## Impact

- **Relay** (`relay/src/`): new `chat.ts` (tool loop and tool definitions), new tables in `db.ts`, and a `fetch` client for the model. No npm dependencies.
- **Web** (`web/src/console/`): new `Chat.tsx` and card components. Home, Layout, Search and Invoices change.
- **Env:** `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`, `CHAT_DAILY_LIMIT`.
- **Dependencies:** requires `web-console-checkout`, for sessions, the relayer, `signDelegate` and the console screens, and `contract-invoices-views`. Needs a NEAR AI Cloud API key. Without one, any OpenAI-compatible endpoint works, but inference is then not private.
