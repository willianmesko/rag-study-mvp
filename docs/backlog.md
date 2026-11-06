# Product Backlog

This backlog separates completed demo capabilities from work that requires a
product decision, credentials, or additional operational cost.

## Completed

- Custom RAG with chunking, interchangeable embeddings, pgvector, hybrid
  retrieval (vector + keyword + RRF), basic prompt-injection filtering, and
  cited answers.
- Supabase Auth, asynchronous PDF/DOCX/TXT/Markdown ingestion, local text
  extraction, processing status, and job retry.
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
- Ingestion pipeline visualization: file received, extraction, chunking,
  security scan, embeddings, and vector persistence.
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
- Feature-Sliced Design frontend and npm-workspaces monorepo with shared Zod
  contracts in `packages/contracts`.
- Professional UX/UI first pass: shared design tokens and components, clearer
  information architecture, workspace-aware question/search flows, responsive
  layouts, keyboard-visible focus states, reduced-motion support, loading/
  empty/error/success states, animated ingestion progress, source inspection,
  and document/job filters in the administration area.
- CI quality gates for every push and pull request: typecheck, unit tests,
  production builds, prompt-injection regression, deterministic golden-set
  retrieval, and Promptfoo security checks.

## Next, in priority order

1. **Security and cost controls**
   - Capture provider-native token usage where each provider exposes it; current
     hosted-demo metrics use a documented character-based estimate.
   - Add external notification delivery for budget alerts if the demo grows
     beyond the owner-only dashboard.

2. **Improve ingestion**
   - Add OCR for scanned PDFs. OCR (Optical Character Recognition) converts text
     inside an image into selectable, searchable text before chunking.
   - Support URL/HTML import, metadata extraction, language detection, and
     structure-aware chunking.
   - Add OCR-specific quality signals to the existing ingestion timeline.

3. **RAG pipeline visualization**
   - Add a limited, explicitly approved chunk preview to the existing timeline.
   - Keep the UI clear that a retrieval score is similarity, not factual
     certainty, and that a document can produce many chunks.

4. **Retrieval quality and observability**
   - Evaluate Jina reranking against the golden set before enabling it.
   - Add LangSmith or Langfuse/Phoenix traces under an approved data policy.
   - Compare providers and prompts with a versioned evaluation report.

5. **Production readiness**
   - Review RLS policies again before exposing any new database API surface.
   - Move high-volume jobs to Redis + BullMQ and a dedicated worker only when
     workload justifies its cost.
   - Add backups, retention policy, domain, identity limits, and incident runbook
     before onboarding real users.

6. **Professional UX/UI hardening**
   - Run screenshot-based visual QA on mobile, tablet, and desktop in CI once a
     browser runner is available in the deployment pipeline.
   - Add a formal visual-regression baseline and automated contrast checks.
   - Continue refining member management and workspace onboarding with the same
     design tokens and state model.
