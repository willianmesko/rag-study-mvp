# Durable conversations and product history

Signed-in members can keep a named, private conversation inside a workspace,
reopen it on another device, continue asking grounded questions, and rate replies.
The public demo remains ephemeral. Conversations use the existing API,
PostgreSQL, Supabase login, and SSE transport; no additional paid service is
required.

## Product behavior

- **Ask** creates a conversation on the first submission and names it from the
  question, with detected PII removed from the generated name.
- **Chats** and **History** list the current member's conversations in the
  selected workspace. Names can be edited. **New chat** starts a separate thread
  without deleting the old one.
- A conversation URL contains its UUID. The same signed-in member can open it on
  another device after selecting the same workspace. IDs are identifiers, never
  authorization credentials.
- Newest messages load first, in chronological order. **Load older messages**
  pages backward without changing message IDs or ordering.
- Questions, checked replies and citation excerpts, model comparisons, and
  thumbs-up/thumbs-down ratings are saved in backend product records. A rating
  can be changed or cleared by clicking the selected rating again.
- Reopening a pending answer attaches to its existing execution. Disconnecting
  a browser does not cancel the provider. **Stop answer** requests cancellation
  on the server. Deleting the conversation also removes the associated work.
- The JSON fallback uses the same persisted admission and execution UUID as SSE.
  It polls the authorized product record instead of starting a separate answer.

Previously browser-local history is not automatically imported: the server
cannot retroactively verify its author, workspace, or cited passages. Existing
anonymous demo history remains local to that browser.

## Visibility, retention, and deletion

Conversations are private to their author within a workspace. An owner can
manage the team but cannot inspect another member's conversation. Owners,
editors, and viewers can all keep their own chats; doing so grants no document
editing permission. Every API operation verifies the login and explicit
workspace, and every repository operation checks current membership plus
conversation ownership. The workspace is never inferred from a conversation ID.

Content is retained for **90 days after the last submitted message**. Reading,
renaming, or rating a conversation does not extend retention. Expired records
are immediately inaccessible, even before cleanup. A bounded cleanup runs while
the API is awake and resumes on startup; a sleeping free service does not run a
continuous cleanup job. Limits are 100 unexpired conversations per member per
workspace and 500 question/reply pairs per conversation.

Deleting a conversation removes its turns, ratings, linked chat replay/events,
and linked workflow records, checkpoints, and effect records through foreign-key
cascades. Running workers lose their lease/record and abort provider work at the
next cancellation check. A late completion cannot recreate the deleted records.
Removing workspace membership also cascades that member's private history.
Document deletion does not rewrite a historical answer: saved excerpts preserve
the checked evidence shown at answer time, while opening a removed original may
no longer be possible. Database backups follow the hosting provider's separate
retention policy; application deletion does not promise immediate backup erasure.

Raw questions, answers, document passages, and manually entered names belong
only in authorized product records or encrypted execution checkpoints.
Operational logs and audit events retain IDs, statuses, rating values, counts,
and usage metadata, not content. LangGraph content traces are suppressed;
optional LangSmith workflow summaries expose bounded metadata rather than input
text and source passages. Saved conversations bypass the workspace-wide semantic
answer cache, including their first question, so deleting a private conversation
does not leave its answer in a shared cache. The anonymous/cache-enabled Q&A path
keeps its existing policy.

## Data model and ordering

```mermaid
erDiagram
  TENANT_MEMBERSHIPS ||--o{ CONVERSATIONS : owns
  CONVERSATIONS ||--o{ CONVERSATION_TURNS : orders
  CONVERSATIONS ||--o{ CHAT_RUNS : links
  CONVERSATIONS ||--o{ WORKFLOW_RUNS : links
  CHAT_RUNS ||--o{ CHAT_RUN_EVENTS : publishes
  WORKFLOW_RUNS ||--o{ WORKFLOW_CHECKPOINTS : checkpoints
```

`conversations` has a composite `(tenant_id, owner_id, id)` key, a name, timestamps,
expiry, and the next sequence counter. A `conversation_turns` row represents an
ordered question/reply pair. It owns immutable user-message and assistant-message
UUIDs, the execution UUID, a sequence, answer/comparison mode, canonical input,
execution status, checked response, rating, and safe failure code. The response
includes provider/model identity, prompt version, token provenance, latency,
estimated cost, and safety/citation outcomes when supplied by the answering path.

The conversation row lock serializes admissions. A partial unique index permits
one queued/running turn per conversation; other conversations can execute
independently. Conversation lists use keyset pagination with the database's full
microsecond timestamp plus UUID, and turn pages use the integer sequence.
Pagination does not use offsets that shift when new messages arrive.

RLS is enabled. Public, anonymous, authenticated, and service-role Data API roles
have no grants on the private history tables. Access goes through the backend's
database connection and explicit scope checks. The publication trigger runs with
invoker privileges and a fixed search path, without a security-definer bypass.

## Idempotent admission and completion

```mermaid
sequenceDiagram
  participant Browser
  participant API
  participant DB as PostgreSQL
  participant Worker
  participant Model
  Browser->>API: conversationId + stable runId + question
  API->>DB: Verify membership/owner, lock conversation
  DB->>DB: Insert one turn, two message IDs, request hash
  DB-->>API: Existing or new canonical turn
  API->>DB: Admit execution with same runId
  API-->>Browser: SSE events or JSON 202
  Worker->>Model: Bounded generation with workspace evidence
  Model-->>Worker: Structured answer
  Worker->>DB: Publish checked terminal event
  DB->>DB: Commit replay event and product reply atomically
  Browser->>API: Reconnect or open on another device
  API->>DB: Recheck membership and conversation ownership
  DB-->>Browser: Same message IDs, ordered reply and rating
```

The browser generates the conversation UUID before creation and the run UUID
before submission. Retries retain those IDs. The repository compares a SHA-256
hash of mode, question, retrieval limit, model aliases, and prompt variants. The
same execution ID with different input or another conversation returns `409`.
Reusing an admitted ID returns the original turn without consuming another
question quota or calling a provider again.

The queued product turn doubles as an admission outbox. A dispatcher retries
queued admission after a server interruption using the same run ID. Existing
workflow/chat admission ensures only one execution is created. Server-side
context selects the last three successful questions in the same private
conversation, each bounded to 500 characters; client-supplied history is rejected
for saved conversations. Each new question still performs fresh workspace
retrieval. This is bounded conversational RAG, not unbounded full-transcript
memory.

An invoker trigger synchronizes terminal `chat_run_events` and the saved turn in
one transaction. Returned chunk/document identifiers must belong to the
workspace, and cited IDs must be present in the checked sources. Cancellation,
deadline expiry, provider failure, and workflow recovery update the same turn.
Chat replay can expire after 24 hours while the product reply remains available
for its own retention period. A completed saved result can be replayed without
calling the model after the short-lived event log has expired.

Comparisons retain both checked answers in one ordered turn. Admission is
durable and claimed once; a browser disconnect does not abort the task. If the
server dies during a claimed comparison, its deadline marks it interrupted.
The system does **not** silently repeat an uncertain provider call and charge
again. A user can submit a new comparison explicitly. Native durable workflow
recovery continues to apply to normal saved chat when enabled.

## API

All routes below require `Authorization: Bearer <access-token>` and an explicit
`X-Workspace-Id`. Request and response contracts are shared in
`packages/contracts` and validated with Zod.

| Operation | Endpoint |
| --- | --- |
| Create idempotently | `POST /v1/conversations` with `{id, title?}` |
| List own conversations | `GET /v1/conversations?limit=20&cursor=...` |
| Read message pairs | `GET /v1/conversations/:id/messages?limit=25&before=...` |
| Rename | `PATCH /v1/conversations/:id` with `{title}` |
| Delete one / all own workspace history | `DELETE /v1/conversations/:id` / `DELETE /v1/conversations` |
| Set or clear feedback | `PUT /v1/conversations/:id/messages/:assistantId/feedback` with `{value: "up" \| "down" \| null}` |
| Inspect a saved execution | `GET /v1/conversations/:id/runs/:runId` |
| Request cancellation | `POST /v1/conversations/:id/runs/:runId/cancel` |
| Submit a saved question | `POST /v1/qa/stream` with `{conversationId, runId, question, topK?, modelId?}` |
| Submit without SSE | Same endpoint and body, with `Accept: application/json` |
| Submit a saved comparison | `POST /v1/qa/compare` with conversation/run IDs and the comparison contract |

Model selection uses workspace-approved backend aliases, never arbitrary
provider identifiers. A replay remains readable even if a previously selected
model has since been disabled. History mutations have bounded request sizes,
pagination, rate limits, and identifier-only audit events. Responses carry the
existing `Cache-Control: no-store` policy.

## Local setup and verification

Apply the generated migration using the normal migration runner before starting
the updated API:

```bash
npm run db:migrate
npm run dev:api
npm run dev:web
```

Sign in, select a workspace with an indexed document, send a question, and open
**Chats**. Rename the thread, rate a reply, then sign in on another browser and
open **History**. The reply and rating must match. Start a follow-up, reload, and
confirm that the same question/reply pair finishes once.

Automated checks use a disposable local database and synthetic browser fixtures:

```bash
npm run eval:harness -- --report /tmp/lumora-harness.json
DATABASE_URL=postgresql://rag:rag@127.0.0.1:5432/rag \
MCP_TEST_DATABASE_URL=postgresql://rag:rag@127.0.0.1:5432/rag \
AGENT_ACTION_TEST_DATABASE_URL=postgresql://rag:rag@127.0.0.1:5432/rag \
  npm run test:mcp:postgres
npx playwright test tests/ux/durable-conversations.spec.ts
```

Database tests cover concurrent retries, stable message IDs, scope/ownership,
checked publication, pagination precision, outbox recovery, API authorization,
saved comparisons, ratings, cancellation, retention, deletion cascades, and RLS.
Browser tests cover cross-device reopening, navigation, rename/delete, feedback,
older messages, recovery, comparisons, JSON fallback, responsive snapshots, and
accessibility. No production document or real conversation is used as a fixture.
