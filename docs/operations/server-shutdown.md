# Bounded API and worker shutdown

The API process owns HTTP admission, the legacy ingestion poller, retention
cleanup, durable workflow work, database pools and telemetry. `SIGINT`, `SIGTERM`
and a listening failure use one shutdown promise. Repeated signals do not start
another drain or resource-close sequence.

## Deadline and order

`SERVER_SHUTDOWN_TIMEOUT_MS` defaults to **25,000 ms** and accepts 1,000–25,000 ms.
Keep it below the hosting platform's termination grace period. This is a process
shutdown budget, separate from provider, workflow and PostgreSQL deadlines.

1. Stop interval admission and start closing HTTP. Existing stream shutdown
   hooks still stop transient delivery and preserve the durable execution ID.
2. Abort the process-owned legacy ingestion signal. Drain HTTP and the current
   legacy ingestion/retention tasks for at most 80% of the shutdown budget.
3. Always start resource cleanup and telemetry flush, even if a previous stage
   failed or never settled. Resource cleanup closes workflow work before pools;
   a workflow-close failure cannot skip either pool-close attempt.
4. Use the remaining budget for cleanup. Exit with code 0 for a completed normal
   shutdown, or 1 for a failure, deadline or startup failure. A provider that
   ignores cancellation cannot keep the process alive indefinitely.

Cleanup is bounded best effort. A hard exit can prevent an unfinished flush or
database close from acknowledging completion. It is not a promise that every
remote operation has stopped or that a charge was reversed. Native PostgreSQL
statement/lock limits remain important behind a transaction pooler, where
closing the application socket does not necessarily cancel the backend instantly.

## Ingestion and recovery

Source downloads, extraction/OCR, embeddings and document persistence receive
the legacy worker's cancellation signal. A late provider result cannot publish a
completed legacy job after cancellation. Interrupted legacy processing is
recorded as `processing_interrupted`; the document requires review before an
explicit retry because a remote call or database commit may have an uncertain
outcome. Already committed completion is not undone by shutdown.

Recording the interrupted status also depends on database availability. A hard
process kill can bypass that update; legacy stale-job recovery has no provider
effect journal and cannot prove that a paid request was not accepted. Use durable
workflow execution for hosted paid processing and inspect uncertain legacy work
before retrying. This shutdown change does not invent exactly-once semantics.

Durable admission uses the existing job/workflow ID. If shutdown interrupts an
enqueue acknowledgement, keep that identity for lease/admission reconciliation;
do not falsely fail or enqueue a second independent paid execution. Durable graph
work retains checkpoint and effect-journal rules. See the
[integration recovery runbook](integration-recovery.md) before handling an
`effect_outcome_unknown` receipt. Never clear it merely to make a retry run.

## Diagnostics and verification

The fixed `server_shutdown` event records the reason, outcome and, for a failed
stage, `background`, `http`, `drain`, `resources` or `telemetry`. It excludes raw
exceptions, document text, prompts, file paths and credentials. Startup and
background-worker logs use fixed reason codes and the safe error serializer.

```bash
npm run typecheck
npm test
# Use a migrated disposable loopback PostgreSQL instance for this suite.
MCP_TEST_DATABASE_URL="$LOCAL_TEST_DATABASE_URL" npm run test:mcp:postgres
```

Focused tests cover repeated signals, a real child process receiving SIGTERM,
an uncooperative provider, independent cleanup after failure, source/OCR/provider
cancellation, late completion, uncertain durable admission and a real PostgreSQL
wait interrupted during shutdown. The SQL fixture verifies rollback and pool
cleanup. A real local HTTP fixture verifies that cancelling a storage response
body closes that request while another original-file read still succeeds.

No new always-on worker service is required by this change. Split workers only
after measuring queue age, contention, failure isolation and hosting cost.
