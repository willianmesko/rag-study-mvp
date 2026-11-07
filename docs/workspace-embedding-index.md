# Workspace embedding index operations

The workspace pins a provider, an embedding model, and a dimension. Ask model
selection and server-side chat routing use this existing embedding profile.
Vector retrieval always uses the active workspace profile for its query.

## Rollout and initial version

Apply `022_workspace_embedding_indexes.sql` before deploying the API and worker
that enforce embedding revisions. Apply the migration without calling any model.
Before activating an alternate model, ensure every API and ingestion worker runs
the revision-aware release. Older binaries use their deployment-wide embedding
settings and are unsafe for a workspace after an index cutover.

Existing vectors have no historical model identifier. On first use the service
pins the deployed `EMBEDDING_PROVIDER` and its configured model, so deploy with
the settings that generated the existing corpus. For a workspace known to have
been indexed with different settings, stop its ingestion and queries and
explicitly `pin` that known identity before allowing traffic. `pin` can set an
initial identity only. It cannot change an active model.

## Rebuild and activate

Run these commands from the repository root with a trusted operator database
connection. `stage` re-embeds every current chunk. It preserves extracted text,
chunk IDs, document IDs, and citations. A target must return finite, nonzero
vectors with exactly 1,024 dimensions for both queries and documents. A
dimension change requires a separate PostgreSQL schema and index migration.

```sh
npm run embedding:index -- status --workspace "$workspace_id"
npm run embedding:index -- stage --workspace "$workspace_id" \
  --provider ollama --model "$target_embedding_model" --max-chunks 100
npm run embedding:index -- activate --workspace "$workspace_id" \
  --version "$staging_version_id"
```

Run `stage` again with the same provider and model to continue an incomplete or
interrupted rebuild. Use one operator for staging each workspace. The command
processes at most `--max-chunks` per invocation. `status` reports staged vector
and current chunk counts. If a source was replaced or uploaded while staging,
run another batch to cover its new chunks. Activation checks completeness again
inside the same transaction that switches all vectors, increments the active
revision, and clears both semantic caches for that workspace.

The provider work runs without a database transaction. The final switch takes
the workspace lock while it replaces live vectors, so schedule a maintenance
window for large corpora. Requests that embedded against an obsolete revision
can be retried. A response that finished reading before the switch can still
finish generating, and its old embedding cannot enter the new cache.

Staging with OpenRouter or Bedrock requires the explicit
`--allow-external-provider` flag. That operation can send the entire chunked
corpus to the configured endpoint in batches, after the app's identifier
redaction. Verify the workspace's data policy before using a remote endpoint.
The probe for dimension validation sends a fixed synthetic string.

## Roll back or discard

```sh
npm run embedding:index -- rollback --workspace "$workspace_id" \
  --version "$previous_version_id"
npm run embedding:index -- discard --workspace "$workspace_id" \
  --version "$staging_version_id"
```

One previous version is retained. Rollback uses it only when its vectors cover
all current chunks. If an upload or replacement changed the corpus since the
switch, stage a fresh complete rebuild using the previous model and activate
that new version instead. A rollback gets a fresh revision and clears the
workspace cache again. Discard removes only an unfinished staged version.

The test at
`apps/api/src/modules/ai/infrastructure/postgres/pg-workspace-embedding-index.integration.test.ts`
can be run against a migrated disposable local PostgreSQL/pgvector database
with `TEST_EMBEDDING_DATABASE_URL`. It requires a localhost database named
`embedding_cutover_*` and simulates provider responses without network calls.
