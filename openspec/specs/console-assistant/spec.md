# console-assistant Specification

## Purpose

Lets a merchant run console actions and ask about their invoices and payments in natural language, with private inference, while every change still needs the merchant's explicit confirmation and passkey.

## Requirements

### Requirement: Chat threads
`POST /console/chat` with `{threadId?, message}` SHALL append the message to the session merchant's thread (creating a thread titled with the first 60 characters of the message when `threadId` is absent), run the assistant, store its reply, and return the new messages. Threads SHALL be readable only by their merchant.

#### Scenario: New thread
- **WHEN** Kaja sends "Generate invoice for 0.01 BTC" without a thread id
- **THEN** a thread titled "Generate invoice for 0.01 BTC" is created and the reply is returned with its id

#### Scenario: Foreign thread
- **WHEN** Kaja's session posts to a thread of another merchant
- **THEN** the backend answers 404

### Requirement: Model endpoint
The assistant SHALL call an OpenAI-compatible chat completions endpoint at `LLM_BASE_URL` with `LLM_MODEL` and tool definitions, defaulting to NEAR AI Cloud. It SHALL send the system prompt and at most the last 30 messages of the thread. A model error SHALL return a reply saying the assistant is unavailable, without failing the request.

#### Scenario: Model down
- **WHEN** the model endpoint answers 503
- **THEN** the chat returns an assistant message "The assistant is unavailable right now" and the console stays usable

### Requirement: Read tools run directly
The assistant SHALL be able to call read tools without confirmation: list invoices (by status, including expired), get invoice, list payments (by status), get payment, settled totals for today, 7 days or 30 days, accepted tokens, and gateway settings. Each tool SHALL return only the session merchant's data.

#### Scenario: Status question
- **WHEN** Kaja asks "What is the status of invoice #12?"
- **THEN** the assistant reads invoice 12 of her gateway and the reply includes a status card for it

#### Scenario: Other gateway's invoice
- **WHEN** Kaja asks about an invoice that belongs to another gateway
- **THEN** the tool reports it as not found

### Requirement: Write tools only propose
The tools `create_invoice`, `set_risk_tolerance` and `retry_payment` SHALL NOT change anything. They SHALL validate and normalize their input (token allowlisted and enabled, amount converted with the token's decimals, expiry 1 hour to 30 days, memo at most 140 UTF-8 bytes, `max_risk` 0 to 80, payment failed and owned) and store a pending action shown as a confirm card with the exact values.

#### Scenario: Invoice proposed
- **WHEN** Kaja asks "Generate invoice for 0.01 BTC"
- **THEN** the reply carries a confirm card "Create invoice 0.01 nBTC, expires in 1 hour" and no invoice exists yet

#### Scenario: Invalid amount
- **WHEN** the model calls `create_invoice` with amount "0.000000001" for an 8-decimal token
- **THEN** the tool returns an error to the model and no pending action is stored

#### Scenario: Memo too long
- **WHEN** the model calls `create_invoice` with a 200-byte memo
- **THEN** the tool returns an error to the model and no pending action is stored

### Requirement: Merchant executes confirmed actions
A pending action SHALL execute only when the merchant presses Confirm on its card: `create_invoice` and `set_risk_tolerance` through a passkey-signed delegate action and the relayer, `retry_payment` through the operator. The executed values SHALL be the card's stored values, not new model output. After execution the console SHALL record the outcome in the thread, and each pending action SHALL execute at most once.

#### Scenario: Confirmed invoice
- **WHEN** Kaja presses Confirm on the invoice card and approves the passkey prompt
- **THEN** the invoice is created, the thread shows the invoice card with its checkout link, and the confirm card shows Done

#### Scenario: Dismissed
- **WHEN** Kaja presses Dismiss on a confirm card
- **THEN** nothing executes and the card shows Dismissed

#### Scenario: Confirmed twice
- **WHEN** a confirm request arrives for an action already executed
- **THEN** the backend answers 409 and nothing executes again

### Requirement: Bounded assistant loop
For each merchant message the assistant SHALL run at most 6 tool rounds and then reply with what it has. Each merchant SHALL be limited to `CHAT_DAILY_LIMIT` messages per UTC day (default 200); beyond it the backend SHALL answer 429.

#### Scenario: Daily limit reached
- **WHEN** Kaja sends her 201st message of the day with the default limit
- **THEN** the backend answers 429 and the model is not called

### Requirement: Tool trace
Each assistant reply SHALL list the tools it used, shown in plain words (for example "Used invoices, payments").

#### Scenario: Trace shown
- **WHEN** the assistant answered using the invoice and payment tools
- **THEN** the reply shows "Used invoices, payments"
