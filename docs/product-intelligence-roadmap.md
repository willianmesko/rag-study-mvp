# Product intelligence and connected workflows roadmap

Reviewed: 2026-11-12. Status: **planned; no new feature is implemented by this document**.

Source: [shared product brainstorm](https://chatgpt.com/share/6af5cbb0-e4bc-83e8-a4fe-c3b1e9b9343f),
read and reconciled with the repository backlog. The conversation's claims about
saved Space pages, market sizes, vendors, pricing and ROI are not implementation
or market-validation evidence. This record captures product hypotheses and
acceptance criteria, not promised results, delivery dates or customer commitments.

Lumora remains a general-purpose product. Condominium administrators, franchise
networks, legal teams, support teams and other industries are optional examples
and templates, not hardcoded tenant types or separate product architectures.

## Existing capabilities to reuse

| Existing foundation | New work must extend, not duplicate |
| --- | --- |
| Workspace membership, owner/editor/viewer, scoped retrieval, RLS | Collection/document ACLs and permission-preserving external connectors |
| Hybrid retrieval, citations, bounded previews, protected originals | Exact page/section/version navigation and document change review |
| OCR, language metadata, structure-aware ingestion and ingestion timeline | Table/chart/image understanding and batch/connector intake |
| Private conversations and feedback | Authorized aggregate analytics, reviewed topics and handoff |
| Model allowlists/comparison, usage ledger and cost provenance | Business insights and quality/cost views that reuse real measurements |
| Evals, golden sets and regression harness | Workspace-reviewed datasets and feature-specific evaluation cases |
| Durable workflows, approvals, budgets, idempotency, outbox/retries/dead-letter tooling | Product automation recipes and authorized integrations |
| Starter libraries and guided onboarding | Optional templates and task-specific adoption flows |
| HTTP API and project-owned MCP | Public integration contracts, SDK ergonomics and signed event webhooks |

See [existing backlog](backlog.md) for implementation, deployment and activation
limits. In particular, a received safe LangSmith streaming trace remains an
activation check; source code or a successful deploy does not prove delivery.

## Delivery policy and order

Finish the currently approved NestJS/Fastify/DI and Prisma migration increment
and its rollout checks before starting another runtime refactor. Do not install
a second workflow engine, ORM, vector database or agent framework for these ideas.

Priority here describes product value and prerequisites, not a vulnerability
severity or a guarantee of commercial demand. No external write action is
activated merely by adding it to this roadmap.

1. Finish current architecture/security/observability release gates.
2. Start product discovery with **PI-03 knowledge analytics**, **PI-04 reviewed
   knowledge gaps**, **PI-05 evidence-backed extraction**, and **PI-06 comparison**.
3. Close **PI-01 source provenance** and **PI-02 ACL** prerequisites before any
   feature promises page/version accuracy or narrower-than-workspace access.
4. Add reviewed tasks and obligations, then alerts and one email draft workflow.
5. Expand connectors, distribution and automation only after the first useful
   workflow is evaluated with authorized pilot data.

| Priority | IDs | Intended outcome |
| --- | --- | --- |
| P0: trustworthy product intelligence | PI-01–PI-05 | Clear evidence, explicit access and useful measured insights |
| P1: document operations | PI-06–PI-13 | Turn evidence into reviewed changes, tasks, drafts and reports |
| P2: connected adoption | PI-14–PI-18 | Keep knowledge current and distribute reusable workflows |
| P3: conditional differentiation | PI-19–PI-22 | Add channels, graph queries, richer media or voice when justified |

## P0 — Trustworthy product intelligence

- [ ] **PI-01 — Source page, section and immutable-version navigation.**
  Extend existing citations/original viewing with page/section anchors and the
  source version used by the answer. A citation opens its authorized original
  at the matching location where extraction supports it. Unknown page/section
  values stay unknown; never fabricate an anchor. Test scanned/native PDFs,
  HTML, changed/deleted versions and unauthorized access. Citation validity and
  similarity remain distinct from factual certainty. Depends on retained
  provenance; version-specific navigation is completed with PI-06.

- [ ] **PI-02 — Knowledge collections and document-level access.**
  Add optional collections for projects, units or teams, with explicit grants
  where workspace-wide access is insufficient. Reuse workspace membership;
  do not make every unit a new tenant. Enforce ACLs before vector and keyword
  retrieval/fusion, and throughout cache reuse, previews, original access,
  citations, conversation reopening, reports and MCP. Revocation must not leave
  accessible cached passages. Test cross-workspace and cross-collection denies,
  inherited grants, role changes and inaccessible-source existence leakage.
  External source permissions must map to this policy or fail closed (PI-14).

- [ ] **PI-03 — Knowledge analytics for workspace owners.**
  Reuse usage/feedback records for question volume, supported answers, refusals
  by reason, eligible feedback, source usage and adoption trends. Include time
  windows, denominators, absent data and model/latency/cost provenance. Aggregate
  views must not grant owners access to users' private conversations. Enforce
  minimum aggregation/privacy rules and retention; test authorization and deletion.
  A sourced answer is not automatically correct, and estimated time savings
  must never appear as measured ROI.

- [ ] **PI-04 — Reviewed topics and knowledge-gap triage.**
  Cluster approved/redacted question examples within a workspace, with bounded
  model/embedding spend and a minimum support threshold. Separate retrieval
  misses, missing sources, ACL denials, provider errors and safety refusals;
  suggest a possible gap for human review rather than asserting that content
  is absent. Do not silently mine private chat contents or export them to a
  provider. Define opt-in/purpose, aggregation and retention first. Validate on
  reviewed topic labels, false positives, PII and tenant-isolation cases.

- [ ] **PI-05 — Evidence-backed structured document extraction.**
  Offer backend-allowlisted extraction templates for dates, parties, owners,
  decisions, obligations and other user-selected document fields. Each result
  has a Zod-validated contract, source/version/passage references, explicit
  unknown/ambiguous fields and review status. This extends document analysis;
  it is separate from existing structured chat answers. Test conflicting dates,
  missing fields, OCR errors, adversarial instructions and supported evidence.
  Extraction proposes data; it does not approve or execute an external action.

## P1 — Document operations and reviewed automation

- [ ] **PI-06 — Immutable document versions and meaningful comparison.**
  Retain source hashes, version lineage and authorized original references;
  compare selected versions/documents with exact before/after passages and a
  bounded summary. Preserve the original context of past citations and invalidate
  affected retrieval/cache entries on activation. Flag suspected contradictions
  or stale content for review, including effective dates; never treat every
  difference as an error. Test rollback, deletion/retention and two-sided ACLs.
  Reuse PI-01 and PI-05; graph-style cross-document reasoning remains PI-20.

- [ ] **PI-07 — Propose tasks, decisions and obligations from documents.**
  Build on PI-05 to suggest actionable items from minutes, manuals or other
  source types. Include evidence, document version and ambiguous owner/deadline
  markers. A reviewer confirms the proposal before creating a tracked obligation.
  Test repeated uploads, source revisions, untrusted instructions and deduplication.

- [ ] **PI-08 — Task and obligation workspace.**
  Add assignees, due dates, status, source links and review/audit history to
  approved items. Validate membership, owner/editor/viewer permissions, time
  zones and state transitions. Assignment and approval policies are deterministic
  code. Replayed events must not create duplicate tasks; source deletion and
  member removal have an explicit retention/access policy. Depends on PI-07.

- [ ] **PI-09 — Deadline, pending-work and document-change alerts.**
  Schedule approved obligation dates and reviewed change rules. Reuse the
  existing outbox, bounded retries, idempotency and dead-letter mechanisms;
  configure channels and quiet hours, deduplicate reminders and cancel stale
  reminders when a source or obligation changes. Acknowledge/resolve alerts.
  Test time zones, clock boundaries, revocation, permanent delivery failure and
  signed webhook verification. Do not notify from unconfirmed extracted dates.

- [ ] **PI-10 — Email intake and cited reply drafts.**
  Pilot one of Outlook or Gmail with least-privilege OAuth, selected folders,
  encrypted credentials and explicit account-to-workspace mapping. Classify an
  authorized message, retrieve allowed evidence and prepare a cited draft.
  Ambiguous identities/workspaces require review; message text and attachments
  are untrusted input. Sending requires separate authorization and approval of
  the exact recipients/content, with expiry/stale-state checks and idempotency.
  Test retries, rate limits, revoked access, malicious attachments and wrong-tenant
  routing. Do not request broad mailbox or send scopes just to read a folder.

- [ ] **PI-11 — Reusable event-to-action workflow recipes.**
  Productize the existing durable workflow engine for document-ready, approved
  change, reviewed insight or scheduled triggers. Start with fixed recipes,
  not an arbitrary-code/no-code builder. Expose safe execution status and review
  queues. Each action has tool/schema allowlists, authorization, token/cost/step
  limits, deadlines, cancellation and replayable audit events. Recover across
  restarts and approve sensitive effects; reuse existing isolation/retry policies.

- [ ] **PI-12 — Grounded scheduled and on-demand reports.**
  Generate a bounded summary of authorized tasks, deadlines, source changes and
  knowledge gaps for a chosen period. Include source references, measured versus
  inferred labels and a reviewable export. Test missing data, ACLs, period/time-zone
  boundaries, output validation and spend limits. Automatic email/external sharing
  requires the same approved-delivery policy as PI-10/PI-17.

- [ ] **PI-13 — Human handoff with authorized context.**
  Let a user escalate an unresolved question to an internal review queue, and
  later to an approved help-desk connector. Preview which question/source
  snippets will be shared and with whom; apply redaction and access checks.
  Track reviewed resolution and actual resolution time. External ticket creation
  is a write action with explicit approval, idempotency and audit. Reuse the
  existing conversation history; do not expose it wholesale to administrators.

## P2 — Connected adoption and reusable product configuration

- [ ] **PI-14 — Permission-preserving document synchronization.**
  Pilot one source, Google Drive or SharePoint, before adding Notion, Confluence
  or other adapters. Store scoped connection state, incremental cursors and
  content hashes; handle updates, tombstones, disconnects and ACL revocation.
  Fail closed on unresolved permissions. Reuse ingestion, version activation,
  idempotency, retries and rate-limit guards. Test resync after stale cursors,
  duplicate delivery and inaccessible-source cleanup. Depends on PI-02/PI-06.

- [ ] **PI-15 — Reviewed operational updates and guided learning.**
  A manager reviews a document diff, selects an authorized audience and publishes
  an update with source/version links. Optional read acknowledgments and short
  knowledge checks show completion, not proof of understanding or compliance.
  Test audience changes, revocation, privacy/retention and mobile accessibility.
  This extends onboarding into ongoing training; it does not duplicate the
  existing Milo product introduction. Depends on PI-06 and PI-11.

- [ ] **PI-16 — Optional reusable workflow and demonstration templates.**
  Extend existing knowledge/process, support and learning libraries with safe
  synthetic tasks, documents, sample questions and approval recipes. Optional
  examples include meetings/contracts, manuals/unit updates and service requests.
  Explain data handling and expected results. Keep domains configurable and
  verify that a new workspace can adopt or skip a template without leaking data.
  No separate hardcoded condominium/franchise backend is required.

- [ ] **PI-17 — Supported public integration API/SDK and signed event webhooks.**
  Build on the existing HTTP/MCP interfaces with documented versioned contracts,
  scoped service identities, token expiry/rotation, pagination and resource limits.
  Offer signed, idempotent events for n8n or client systems using the existing
  outbox and replay tools. Test signatures, replay windows, rate limits, endpoint
  egress policy and revocation. Tool/action access is explicitly allowlisted;
  do not expose all internal endpoints as a public automation surface.

- [ ] **PI-18 — Configurable assistant profiles.**
  Let authorized users choose approved source collections, versioned instructions,
  model aliases and permitted workflow recipes for a named assistant. The backend
  owns tool allowlists, budgets and authorization; profiles cannot expand access.
  Reuse existing model/provider routing and prompts. Evaluate each profile on
  reviewed cases before activation. Arbitrary tools/code or uncontrolled
  multi-agent execution are outside this ticket.

## P3 — Conditional differentiation

- [ ] **PI-19 — WhatsApp Business, Slack or Teams delivery.**
  Select a channel only after pilot demand. Verify the external identity and
  workspace, group/recipient access, opt-in/retention and safe handoff; fail closed
  on unknown mappings. Use approved provider APIs and existing action policies.
  Test a private-source answer cannot reach an unauthorized channel or group.
  Existing MCP connectivity is not equivalent to a production messaging bot.

- [ ] **PI-20 — Evidence-backed entities and knowledge relationships.**
  Prototype provenance-linked entities/relationships over a reviewed corpus and
  demonstrate queries that ordinary retrieval cannot answer adequately. Resolve
  duplicate names and versioned/conflicting relationships with human review;
  enforce ACLs during traversal. Add contradiction/staleness hypotheses only
  with supporting passages and effective dates. Compare against a SQL-based
  approach before selecting a graph database or dedicated GraphRAG framework.

- [ ] **PI-21 — Advanced multimodal document understanding.**
  Extend existing OCR to preserve useful table structure, charts and relevant
  images with page/version evidence and extraction quality indicators. Evaluate
  numeric/tabular accuracy and OCR failure modes on reviewed fixtures. Bound file,
  page, model and token costs and apply existing PII/security policies. Basic
  scanned-PDF OCR is already implemented and is not a new deliverable here.

- [ ] **PI-22 — Accessible voice interaction.**
  Evaluate speech input/output only when users need it. Define recording consent,
  storage/retention, transcript correction and text equivalents. Reuse the same
  workspace retrieval, citations and budgets. Measure transcription error and
  accessibility; do not weaken source visibility or authorize actions from an
  unverified voice transcript.

## Product validation work, separate from feature implementation

- [ ] **PV-01 — Demonstrate a repeatable workflow with authorized pilot users.**
  Measure a manual baseline and the same task with Lumora, recording sample size,
  grounding quality, human edits, observed task time, provider spend and setup
  effort. Distinguish observed savings from estimates and avoid treating them as
  realized financial ROI. Test a general-purpose workflow with multiple teams;
  optional industry examples do not select a permanent niche. Pricing, willingness
  to pay and customer demand remain hypotheses. No prospect outreach, email,
  billing activation or publication is authorized by this planning task.

## Acceptance and maintenance

Every PI item is currently unchecked. Creating this plan does not complete the
feature, confirm an external integration or activate an agent action. When an
item is implemented, link its code/tests and evaluation evidence, state local/CI/
hosted validation separately and update this file and `backlog.md` together.
Keep existing engineering/observability activation items in their original
backlogs rather than recreating them here.
