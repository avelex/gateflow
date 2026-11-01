# Spec Delta

## MODIFIED Requirements

### Requirement: Console layout
The console SHALL show a collapsible sidebar with Home, Invoices, Screening (with a count of Pending payments), Search, a Recents list of the merchant's latest chat threads, and the merchant's name and email, with a profile menu offering Settings and Sign out, in the ported Gateflow design.

#### Scenario: Pending count
- **WHEN** Kaja's gateway has 2 Pending payments
- **THEN** the Screening item shows 2

#### Scenario: Recent chat reopened
- **WHEN** Kaja clicks a thread under Recents
- **THEN** the chat view opens with that thread's messages

### Requirement: Home
Home SHALL greet the merchant, show today's settled totals per token, and show the assistant composer with hint chips ("Create invoice for 0.01 BTC", "Which invoices are unpaid?", "What was returned this week?", "Lower my risk tolerance"). Sending from Home SHALL open a new thread in the chat view.

#### Scenario: Settled today
- **WHEN** two USDC payments of 10 and 5 settled today
- **THEN** Home shows 15 USDC processed today

#### Scenario: Hint chip
- **WHEN** Kaja clicks "Which invoices are unpaid?"
- **THEN** a new thread opens with that message and the assistant's answer

### Requirement: Search
Search (shortcut Cmd/Ctrl+K) SHALL find the merchant's invoices, payments and chat threads by id, amount, token, memo, payer or thread title, and open the matching item. With no match, pressing Enter SHALL ask the assistant the query in a new thread.

#### Scenario: Find by amount
- **WHEN** Kaja searches "0.01"
- **THEN** invoices and payments of amount 0.01 are listed

#### Scenario: Ask instead
- **WHEN** Kaja's search has no matches and she presses Enter
- **THEN** a new thread opens with her query as the first message

## ADDED Requirements

### Requirement: Ask about invoices
The Invoices screen SHALL offer an input "Ask about invoices" that sends its text to the assistant in a new thread and opens the chat view.

#### Scenario: Question from Invoices
- **WHEN** Kaja types "Which invoices are unpaid for more than 24 h?" in the Invoices input
- **THEN** the chat view opens with that question and the answer
