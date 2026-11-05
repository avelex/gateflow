## ADDED Requirements

### Requirement: Plain-text replies
The system prompt SHALL tell the model to answer in plain text without Markdown, and its amount example SHALL use the display symbol `BTC`. The chat SHALL show reply text as written.

#### Scenario: Prompt rule
- **WHEN** the relay builds the system prompt
- **THEN** it contains a rule to write plain text without Markdown, such as `**` or `#`, and no mention of `nBTC`

#### Scenario: Invoice proposal reply
- **WHEN** the merchant asks for a 0.01 BTC invoice
- **THEN** the reply names "0.01 BTC" with no asterisks around it

### Requirement: Assistant names the payer like the console
The payment facts given to the model SHALL name the payer by the same rule as the console: the origin sender and chain when known, else the NEAR refund account for a cross-chain payment, else the paying account.

#### Scenario: Cross-chain payer
- **WHEN** the model reads a payment with a `ref`, sender `intents.near` and refund account `bob.near`, with no known origin sender
- **THEN** the payer it receives is `bob.near`

### Requirement: Thinking indicator
While a reply is pending, the chat SHALL show an animated thinking indicator, and SHALL show it without motion when the viewer prefers reduced motion.

#### Scenario: Waiting for a reply
- **WHEN** Kaja sends a message and the reply has not arrived
- **THEN** an animated "Thinking" indicator shows below her message until the reply appears

#### Scenario: Reduced motion
- **WHEN** the browser reports `prefers-reduced-motion: reduce`
- **THEN** the indicator shows "Thinking…" without animation
