# Product Backlog

This backlog separates completed demo capabilities from work that requires a
product decision, credentials, or additional operational cost.

Lumora is a general-purpose knowledge workspace for teams across industries.
Onboarding and demonstrations are organized around goals and document types.
IT and legal scenarios remain optional study examples.

## Completed

- Custom RAG with chunking, interchangeable embeddings, pgvector, hybrid
  retrieval (vector + keyword + RRF), basic prompt-injection filtering, and
  cited answers.
- Supabase Auth, asynchronous PDF/DOCX/TXT/Markdown ingestion, local text
  extraction, processing status, and job retry.
- Local Portuguese and English OCR for scanned PDFs, including mixed documents
  with selectable text. The ingestion timeline records duration, page counts,
  recognition confidence, and actionable failure messages. The Docker image
  verifies both languages on synthetic scanned PDFs during its build.
- Private original-file storage, constrained upload size and MIME types, and a
  server-only storage adapter.
- Tenant isolation for documents and jobs. The tenant is derived from validated
  membership, never trusted from client input.
- Daily tenant question quota, daily administrator upload-byte quota, and an
  audit trail that contains identifiers and technical metadata, not question,
  document, or IP contents.
- Deterministic golden set, prompt-injection suite, unit tests, type checking,
  build verification, and GitHub Actions.
- Document management: list, inspect chunks, reindex from a private original,
  delete, clickable answer sources, and browser-local question feedback.
- Original uploads in Knowledge: workspace members can open retained PDFs or
  download the original bytes for the indexed revision. The API checks access
  and audits reads.
- Advanced ingestion: owners and editors can import public HTTPS pages or
  HTML uploads. Ingestion extracts available title and description, labels the
  detected language, and chunks HTML, Markdown, and DOCX using headings. PDFs
  keep page boundaries. URL downloads enforce public network destinations,
  content type, redirect limits, and byte and time budgets.
- Ingestion pipeline visualization: file received, extraction, chunking,
  security scan, embeddings, and vector persistence.
- RAG evidence visualization: validated citations and model context are shown
  separately. Ask and Search explain cosine similarity. Search and Processing
  offer bounded, redacted previews, and Processing samples only the current
  indexed revision for owners and editors.
- Persisted ingestion timeline: stage start/end events, durations, safe counts,
  and errors are available to the protected administration UI without storing
  document content in the event stream.
- PII redaction before external embedding/chat providers, workspace-isolated
  semantic answer cache, per-user question quotas, estimated usage metrics,
  owner-only usage dashboard, and configurable budget alerts.
- Supabase RLS policies for authenticated workspace reads; backend-only tables
  remain inaccessible through the publishable Data API by design.
- Workspace onboarding, switching, `owner`/`editor`/`viewer` roles, invitations,
  member management, and server-side authorization on every protected route.
- Workspace Control Center: six independent, role-aware sections and a signed-in
  workspace creation action with separate onboarding for each new space. The
  API requires explicit selection for accounts with multiple memberships.
- Resumable signed-in chat with ordered SSE replay, workspace and user scope,
  one quota charge per run, provider cancellation, and checked citations before
  fresh answer deltas. The replay window is 24 hours.
- Feature-Sliced Design frontend and npm-workspaces monorepo with shared Zod
  contracts in `packages/contracts`.
- Professional UX/UI first pass: shared design tokens and components, clearer
  information architecture, workspace-aware question/search flows, responsive
  layouts, keyboard-visible focus states, reduced-motion support, loading/
  empty/error/success states, animated ingestion progress, source inspection,
  and document/job filters in the administration area.
- UX quality checks in CI cover desktop, tablet, and mobile. The main flows use
  consistent button states and clearer English and Brazilian Portuguese copy.
  Team actions explain roles and require confirmation for removal.
- The main app uses the full viewport width, with desktop navigation aligned
  to the left screen edge and responsive navigation on smaller screens.
- Milo gives a short greeting on sign-in after the image loads. The greeting
  respects the device's reduced-motion preference.
- Milo floats on the shared loading screen while Lumora opens a session,
  loads workspaces, or checks guided setup. Milo stays still with reduced motion.
- Milo's guided setup resumes across devices with workspace- and user-scoped
  progress. Existing browser-only progress syncs when the user returns.
- Milo's setup offers knowledge and processes, support, and learning goals in
  English and Portuguese. Earlier goal selections retain saved progress and
  resume with the corresponding general-purpose examples.
- CI quality gates for every push and pull request: typecheck, unit tests,
  production builds, prompt-injection regression, deterministic golden-set
  retrieval, versioned replay regression, and Promptfoo security checks.
- Bounded agent safety baseline: structured answer parsing with Zod, retrieved
  citation validation, read-only tool allowlist definitions, step and timeout
  guards, configurable output-token limits, and an estimated per-request cost
  ceiling.
- Owner-only evaluation runs show hit rate, MRR, injection pass rate, reviewed
  context precision, and optional public-fixture faithfulness with judge
  calibration, model metadata, coverage, and historical runs.
- Signed-in chat uses an owner-managed workspace model policy. Auto routing
  classifies questions, limits attempts, and can fall back to approved models.
  Side-by-side comparisons share retrieved context and a budget. Run details
  show citation status, prompt version, latency, and provider usage when reported.
- Workspace embedding versions pin the model. Operators can stage a complete
  rebuild, check dimensions, and switch versions with cache invalidation.
- Offline replay tooling validates reviewed anonymized fixtures and gates
  ranking and screening regressions. The bundled synthetic suite can compare
  candidate ranking with Jina through an explicit, credentialed command.
- Ask opens as a conversation with Milo. Signed-in follow-ups use recent
  answered questions to clarify the current request, with new retrieval and
  checked citations on every reply.

## Delivery sequence

1. Advanced ingestion — complete for scanned PDF OCR, static public HTTPS
   pages, HTML uploads, metadata, language detection, and structured chunking.
2. RAG visualization — complete for citation and context separation, controlled
   previews, and score interpretation.
3. UX quality — complete for responsive visual references, automated contrast
   and accessibility checks, layout stability, and team flows.
4. Workspace Control Center — complete for independent sections, additional
   workspace creation, explicit API selection, and tenant isolation checks.
5. Product expansion — demo datasets, backend history and feedback, invites,
   and filters.
6. Real-time chat — complete for connection recovery, persisted run state,
   provider cancellation, and streaming validated citations.
7. Portuguese and English — verify automatic UI locale and evaluate retrieval in
   both languages.
8. Onboarding — standalone Milo flow and cross-device sync complete. Reusable
   templates for knowledge, support, and learning plus a Help entry point remain
   in the guided onboarding backlog.
9. Project-owned MCP — scoped read tools and an isolated approved-evaluation
   path are implemented and tested. Production write workers are opt-in.
10. Models and evaluations — workspace policies, Auto and fallback, embedding
    index migration, comparison, effort profiles, review receipts, and quality
    gates are implemented. Live Jina measurements, live release baselines, and
    reviewed cases from real production workflows remain pending.

Run independent tasks within a milestone in parallel, integrate in this order,
and update this backlog after validating each shipped capability.

## Backlog by area

1. **Security and cost controls**
   - Extend provider-native usage coverage where available. Current generation
     records distinguish reported usage and cost from configured estimates.
   - Add external notification delivery for budget alerts if the demo grows
     beyond the owner-only dashboard.

2. **Improve ingestion**
   - The first advanced ingestion milestone is complete. Checkpointed ingestion
     and selective retries remain part of the LangGraph workflow expansion.
   - The hosted demo's private originals bucket accepts HTML for both URL
     imports and HTML uploads. The deployment guide records the required types.

3. **RAG pipeline visualization**
   - The current UI shows passage counts and offers a bounded preview from a
     completed ingestion. Claim-to-source verification remains in the LangGraph
     workflow expansion.

4. **Retrieval quality and observability**
   - Run the implemented synthetic Jina benchmark with an API key and review
     its measured quality and latency before enabling workspace reranking.
   - Add LangSmith or Langfuse/Phoenix traces under an approved data policy.
   - Add OpenTelemetry spans by workflow stage, request correlation IDs,
     reason-coded logs and metrics, tool-call telemetry, alarms, and runbooks.
     Evaluate Splunk and VictoriaMetrics as operational backends when needed.
   - Compare providers and prompts with a versioned evaluation report.

5. **Production readiness**
   - The [backend scalability review](backend-scalability-review.md) records
     source findings and proposed capacity gates. Execute the mixed-workload
     benchmark before committing to a topology change.
   - Validate whether the current backend architecture meets projected scale.
     Define workload and service targets for active workspaces, concurrent chat
     streams, corpus size, and ingestion bursts. Load-test mixed traffic and
     measure p95 search and chat latency, time to first stream event, error
     rates, queue lag, database connection saturation, and cost per workload.
   - Compare tuning and scaling the current modular API with separating the
     ingestion worker. Include the effect of one busy workspace on others and
     distinguish database or worker bottlenecks from AI provider limits.
     Record the decision, evidence, cost trade-offs, and measurable triggers
     for revisiting it in an architecture decision record.
   - Review RLS policies again before exposing any new database API surface.
   - Review existing Supabase advisories for
     [password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)
     and the [vector extension schema](https://supabase.com/docs/guides/database/database-linter?lint=0014_extension_in_public)
     before onboarding real users.
   - Move high-volume jobs to Redis + BullMQ and a dedicated worker only when
     the scalability review shows that the workload justifies the added cost.
   - Add backups, retention policy, domain, identity limits, and incident runbook
     before onboarding real users.

6. **Professional UX/UI hardening — complete**
   - Shared button and select styles distinguish hover, keyboard focus,
     pressed, disabled, and pending states. Core flows use clearer labels,
     progress, errors, and recovery instructions in English and Brazilian
     Portuguese.
   - Playwright exercises sign-in, Milo, and Team on mobile, tablet, and
     desktop. CI compares checked-in screenshot references, scans contrast
     and accessibility with axe, and checks overflow and interaction stability.
   - Team explains the access granted by each role. Changing a role requires
     saving, and removing access requires confirmation. The API protects
     existing memberships against conflicting invitations.

7. **Workspace Control Center — complete**
   - The former `AdminPanel` is split into `Overview`, `Knowledge`,
     `Processing`, `Team`, `Evaluations`, and `Settings`. Each section has a
     stable route and independent data loading. Overview links to the full
     sections from summary cards.
   - **New workspace** in the signed-in header opens workspace creation and
     starts a separate setup guide. Switching preserves the current section
     when the role in the destination workspace can access it.
   - Viewers can open Overview, Knowledge, and Processing. Editors can manage
     documents. Owners can open Team, Evaluations, and Settings. The API
     validates explicit workspace selection and membership on private operations
     for accounts with multiple spaces.
   - Verified route loading and role guards in Chrome using fixture data, and
     verified workspace-specific citations, cache hits, quotas, and upload
     authorization with two corpora in a disposable PostgreSQL/pgvector database.

8. **Demo and product expansion**
   - Seed reusable demonstration libraries with realistic synthetic handbooks,
     procedures, FAQs, product guides, and project materials. Include suggested
     questions and sources so teams from different industries can explore the
     product and compare separate workspaces.
   - Persist named conversations, questions, answers, and thumbs-up/thumbs-down
     feedback in the backend, scoped by workspace and user, with access across
     signed-in devices.
   - Define conversation visibility, retention, and deletion before enabling
     stored history. Keep conversation content in authorized product records
     and preserve the audit and operational log policy that excludes raw
     questions and document contents.
   - Verify invitation delivery and onboarding with the existing Supabase Auth
     invitation endpoint. Configure a transactional sender if needed.
   - Add document filters for source, language, date range, and file type.
   - Extend model comparisons to controlled prompt variants and safety outcomes.

9. **Model routing and comparative evaluation**
   - Owners manage allowed model aliases, the default, and opt-in Auto routing
     per workspace. Code classifies question complexity, enforces request
     deadlines and configured token and price bounds, and reserves quota before
     a fallback attempt. Explicit model choices and A/B runs keep their model.
   - Ask records the provider, model, prompt version, latency, checked-citation
     count, safety outcome, and usage provenance per run. The judge dashboard
     records injection-suite pass rate and reviewed precision separately.
   - Workspace embedding changes use a staged full-corpus rebuild, dimension
     checks, atomic activation, and cache invalidation. Validate a cutover in
     the target environment before moving its live index.
   - Jina remains an optional independent reranker. Run the implemented
     comparison with the bundled synthetic golden cases before enabling it.
   - CI compares versioned ranking and screening metrics with a reference.
     Supply reviewed live measurement exports to turn on the p95 latency and
     mean cost gate for a release workload.
   - Compare model and effort profiles with a bilingual judge calibration suite,
     reported coverage, and false-positive rates. Use review receipts for
     anonymized replay fixtures. Populate the suite with approved reconstructed
     production cases when available.

10. **LangGraph workflow expansion**
   - Add adaptive RAG: retrieve, apply a relevance gate, rewrite the query when
     evidence is weak, retry retrieval once, and refuse when evidence remains
     insufficient.
   - Citation IDs are already checked against passages sent to the model.
     Add claim-to-source verification and a bounded repair path for invalid
     citations before returning a refusal.
   - Orchestrate advanced ingestion as a checkpointed graph: extraction, text
     quality gate, OCR fallback, metadata, language detection, structure-aware
     chunking, security scan, embeddings, and persistence. Retry only the failed
     node and preserve safe stage metrics.
   - Add an evaluation graph that runs retrieval metrics, answer generation,
     faithfulness, context precision, and security checks into one versioned
     report.
   - Add human-in-the-loop checkpoints for sensitive actions. The graph must
     pause after policy evaluation, persist the approval request, and resume only
     after an authorized user confirms it.
   - Add durable state, cancellation, step limits, timeouts, and per-run budgets
     so a misbehaving model cannot create an unbounded loop or spend indefinitely.

11. **Agent tools and MCP safety**
   - Implemented scoped credentials, current membership checks, owner-only
     reports, strict Zod contracts, safe previews, audits, persistent call
     allowances, deadlines, output limits, and cancellation for MCP reads.
   - The stdio connector runs separately with scoped module reads. An optional
     nonroot container adds a read-only filesystem and OS resource limits.
   - Approved lexical evaluations have a separate worker, fenced leases,
     idempotency, bounded retries, dead-letter status, and replayable events.
   - Before adding effectful integrations, define effect-specific authorization,
     approval, idempotency, external failure handling, and network egress policy.

12. **Infrastructure as code and AWS production reference**
   - Keep the low-cost Render/Supabase demo as the default deployment path.
   - Add Terraform roots and reusable modules for dev, staging, and production,
     with remote state, mandatory tags, least-privilege IAM, permission
     boundaries, and separate plan/apply approvals.
   - Add an optional AWS architecture reference:

     ```text
     CloudFront → API Gateway → Lambda → Step Functions
                                      ├── ingestion
                                      ├── retrieval
                                      ├── agent workflow
                                      └── evaluation replay

     DynamoDB → state and idempotency
     S3 → private source files
     Bedrock → embeddings and chat
     EventBridge → domain events
     CloudWatch → metrics and alarms
     ```

   - Document the mapping between the demo adapters and the AWS adapters before
     enabling any paid AWS resource.

13. **GitLab CI/CD compatibility**
   - Add a `.gitlab-ci.yml` equivalent to the GitHub quality harness.
   - Run typecheck, tests, build, security evals, golden set, Promptfoo, and
     Terraform validation as release gates.
   - Add environment-specific deploy jobs, manual production approval, stored
     evaluation artifacts, and rollback instructions.

14. **Resilient integrations**
   - Add idempotency keys and deduplication to uploads, ingestion jobs, model
     calls, and external notifications.
   - Standardize exponential-backoff retries, rate-limit handling, permanent
     failure classification, and stale-state detection.
   - Add an outbox pattern, dead-letter queue, replay commands, and operational
     runbooks for failed or partially delivered events.

15. **Project-owned MCP server**
   - Implemented `list_sources`, `get_ingestion_status`, owner-only
     `get_quality_report`, bounded `get_document`, and `search_workspace`.
     Search uses PostgreSQL keywords with a zero-provider budget.
   - Owners can create and revoke temporary credentials from Settings. The API
     binds every credential and tool call to the selected workspace.
   - The MCP tool list contains the five reads. Owner-authorized
     `run_evaluation` requests use a separate approval endpoint and isolated
     worker with a fixed lexical/security suite.
   - The [MCP guide](workspace-mcp.md) includes Codex configuration, a worked
     study example, runtime limits, and worker setup.
   - Future work includes remote OAuth-based MCP connections, budgeted hybrid
     search, and production activation of separately hosted approved-action
     workers when the operator provisions their least-privilege connection.

16. **Guided onboarding for non-technical teams**
   - Implemented a dedicated sign-in page, an explicitly separate public demo,
     and a standalone bilingual Milo guide before entering the private app.
     Users can create a workspace, choose a goal, optionally upload a document,
     and explore a sample answer and citation. The workspace opens after they
     finish the guide. Progress is saved per user and workspace in PostgreSQL
     and resumes on another signed-in device. Offline edits retry from a scoped
     browser copy. An older device cannot undo completion.
   - Public demo search and chat use the configured demo corpus. Requests
     carrying a private workspace selector require authenticated membership.
   - Implemented generic goal choices for finding team knowledge, supporting
     others, and learning from documents, with compatible saved progress for
     earlier goal values.
   - Extend the first-run guide for users who do not know RAG terminology or
     infrastructure concepts. Start with a plain-language goal such as “Find
     answers in your team's documents and check the sources.”
   - Guide the user through workspace creation, use-case selection, inviting
     teammates, uploading the first documents, waiting for processing, and
     asking the first grounded question.
   - Explain key concepts at the moment they matter: documents, chunks,
     embeddings, retrieval, citations, similarity scores, and why similarity
     is not factual certainty.
   - Add reusable starter templates for knowledge and processes, support, and
     learning. Include safe sample content, suggested questions, document
     naming guidance, and privacy/data-handling notes. Sector-specific
     scenarios can be offered as optional examples.
   - Add an entry point to revisit the completed guide from Help.
   - Make steps role-aware: owners configure the workspace, editors add
     knowledge, and viewers learn how to search and inspect sources.
   - Acceptance criteria: a new non-technical user can create a workspace,
     ingest a document, ask a question, and understand the cited answer without
     reading technical documentation.

17. **Real-time chat and streaming answers — complete**
   - Ask shows message bubbles in order, supports follow-up questions, keeps
     sources with their reply, and offers a New chat action. The active
     transcript stays in the browser tab while navigating the same workspace.
     Named conversations and cross-device history remain in product expansion.
   - Signed-in requests use an idempotent run ID and receive numbered SSE
     events. Reconnecting in the same tab resumes from the last received event.
     Reloading a tab with an active run replays its events from the beginning.
   - PostgreSQL persists run status, validated output, and ordered events for
     a 24-hour replay window. Membership and the run's actor are checked on
     every connection and cancellation. Raw questions and drafts are excluded
     from replay storage. The public demo remains transient.
   - Stop records a terminal state and aborts in-flight provider requests.
     Structured citations are verified before fresh answer deltas are released.
     Cached responses and refusals are delivered as terminal events.
   - The regular JSON endpoint remains available before SSE admission. Socket
     tests cover reconnection, quota deduplication, cancellation across API
     instances, safe provider failure, and authorization.
   - Follow-up under LangGraph workflow expansion: checkpoint work across a
     server restart. Current in-flight runs end as interrupted if their worker
     exits. Bidirectional collaboration remains a separate future feature.

18. **Portuguese and English support**
   - The interface now supports Brazilian Portuguese and English with automatic
     detection using the device time zone and browser language. Chat language
     fallback and multilingual retrieval evaluation remain follow-up work.
   - Localize the web interface in Brazilian Portuguese (`pt-BR`) and English
     (`en`), including onboarding, workspace navigation, chat statuses, errors,
     and empty states. Format dates and numbers for the selected locale.
   - Prefer Portuguese in recognized Portuguese-speaking time zones, then use
     browser language preferences. Default to English when neither signal
     resolves to a supported locale.
   - Detect the language of each question independently of the interface and
     answer in that language. Use the selected interface language when a
     question is short, ambiguous, or mixes languages without a clear majority.
   - Build on ingestion language detection to label documents as Portuguese,
     English, mixed, or unknown. Keep citation excerpts in the source language.
   - Add acceptance tests for automatic regional and browser selection, and
     English-to-Portuguese and Portuguese-to-English retrieval with grounded
     answers and citations.
