# Demonstration libraries and controlled discovery

## Product flow

Open **Workspace → Knowledge → Demo libraries** to inspect the versioned
fictional catalog. Knowledge, Support, and Learning each contain five documents
in English and Portuguese: a handbook, procedure, FAQ, product guide, and project
brief. They are examples of reusable knowledge across industries. No real
customer information is included.

```mermaid
sequenceDiagram
  actor Member
  participant Web
  participant API
  participant Database
  participant Worker
  Member->>Web: Preview a demonstration library
  Web->>API: Read catalog with explicit workspace
  API->>Database: Verify membership and read source status
  API-->>Web: Bundled content, questions, status
  Member->>Web: Add library (owner or editor)
  loop One bounded request per document
    Web->>API: Library/document key and locale
    API->>Database: Check quota; lock workspace and deduplicate source
    API-->>Web: Existing state or accepted ingestion job
  end
  Worker->>Database: Claim accepted job
  Worker->>Worker: Extract, scan, chunk, embed
  Worker->>Database: Persist indexed document
  Web->>API: Poll catalog while preparation is active
  API-->>Web: Source ready
  Member->>Web: Choose a suggested question
  Web-->>Member: Open Ask with an editable draft
```

Previewing and downloading are provider-free. Adding files uses the existing
upload quota, original-file storage, worker, provider configuration, and audit
trail. Questions require all their listed supporting sources to be ready; the
user still presses Send. Stopping the importer stops further requests. Jobs
already accepted keep processing and remain visible in Processing.

Each source has a deterministic versioned name, such as
`demo/support/v1/en/handbook`. Importing into a second workspace creates an
independent corpus under that workspace's permissions, quotas, and index. A
short database transaction serializes concurrent imports within a workspace.
Existing documents and queued or processing jobs are returned instead of being
overwritten. Failed sources can be retried, and deleted sources can be imported
again. The importer resumes after partial failures by checking every source.

## Contracts and boundaries

| Endpoint | Access | Behavior |
| --- | --- | --- |
| `GET /v1/demo-libraries?locale=en` | Explicit workspace; member | Returns bounded catalog and tenant-scoped source states. |
| `POST /v1/admin/demo-libraries/:libraryId/documents/:documentKey` | Explicit workspace; owner/editor | Accepts only `{ "locale": "en" }` or `pt-BR`. Content, source, filename, and MIME type come from the backend catalog. |
| `GET /v1/admin/documents` | Verified workspace member | Applies validated filters before the result limit. |
| `GET /v1/qa/models` | Explicit workspace; member | Exposes allowed model aliases and approved prompt descriptors. |
| `POST /v1/qa/compare` | Explicit workspace; member | Reserves two question units, prepares one context, and compares approved models or prompts. |

The catalog is bounded to four libraries, five documents per library, and
twenty source statuses. Each seed request has input validation, upload quota,
rate limit, and an audit event with safe metadata. Viewers cannot import.
No original content from another workspace is returned. Logs exclude raw
questions, uploaded contents, headers, IP addresses, and filter values.

## Document filters

The shared `documentFiltersSchema` accepts:

| Field | Meaning |
| --- | --- |
| `q` | Literal case-insensitive substring in title or source. |
| `documentId` | An exact document UUID within the workspace. |
| `source` | Literal case-insensitive source substring. |
| `language` | `en`, `pt`, `mixed`, or `und`. |
| `format` | `pdf`, `docx`, `html`, `markdown`, or `text`. |
| `from`, `to` | Inclusive updated-date range, `YYYY-MM-DD`, using whole UTC days. |

Values use bound SQL parameters and the mandatory tenant predicate. Invalid
calendar dates, reversed ranges, extra fields, and unknown options are rejected.
Filtering occurs on the server before the 100-result limit. The document chooser
uses a bounded unfiltered metadata list; source text can find documents outside
those first 100 choices. Cursor pagination remains a potential corpus-scale
enhancement.

## Fair prompt and model comparison

The browser selects aliases exposed by the active workspace. It cannot submit
an arbitrary provider model identifier or prompt text. Prompt styles are
Balanced (`grounded-v1`), Concise (`grounded-concise-v1`), and Explanatory
(`grounded-explanatory-v1`). Only the trusted presentation instructions vary;
grounding rules, source boundaries, and the structured JSON contract stay fixed.

```text
question → redaction → retrieval → risk screening → bounded context
                                                   ├── model A / prompt A
                                                   └── model B / prompt B
                                                    ↓
                                   structured output and citation checks
                                                    ↓
                               measurements and explicit safety outcomes
```

Change one variable per comparison: two models with one shared prompt, or two
prompt styles with one shared model. Requests that vary both, repeat both, or
name an unapproved option are rejected before provider calls. Both answers use
the same prepared evidence and a combined conservative generation budget, with
timeouts and cancellation. Comparisons bypass the semantic answer cache.

The result includes provider/model, prompt version, generation latency, input
and output token usage with its provenance, estimated cost, citations, and
validation outcome. The exported JSON contains measurements and reference IDs,
excluding conversation text, passage excerpts, and free-form refusal messages.
Unknown refusal reasons become a fixed `model_refused` code. A successful validation means
the format and cited source identifiers passed the implemented checks; it does
not prove every factual claim or establish resistance to all attacks.

## Fixed reference evaluation

The fourth library is an explicit **RAG reference benchmark** matching
`examples/rag-fundamentals.md`. Its stable source is
`golden/rag-fundamentals`; the reviewed retrieval cases expect that name.
Evaluations checks that the source is indexed before making retrieval or judge
calls. The owner can choose **Prepare reference benchmark** to add it through
the same authorized importer. Nothing is silently added to a workspace.

Historical results remain intact. Zero hit rate and MRR mean none of the
questions found their expected source. A label such as 4/4 cases reports coverage.
Faithfulness and judge calibration currently score separate public examples,
which explains how they can pass while workspace retrieval fails. Testing a
team's own corpus requires a workspace-specific reviewed dataset; the reference
benchmark does not supply one automatically.

## Validation

```bash
npm run eval:harness
npm run test:ux -- tests/ux/discovery.spec.mts
```

The harness checks types, unit tests, builds, injection screening, the golden
set, replay regressions, and Promptfoo. UX coverage exercises mobile, tablet,
desktop, English and Portuguese, dialog dropdowns, partial-import retries,
viewer access, questions, filters, reference preparation, export privacy, and
detectable accessibility issues. Screenshot baselines use the pinned Linux
Playwright image. Real PostgreSQL isolation/concurrency tests run against a
disposable local database with `npm run test:mcp:postgres` after the test-only
Supabase auth fixture is installed.
