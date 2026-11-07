# Minimal MCP image verification

The BE-14 follow-up adds a real image check to the existing PostgreSQL/MCP CI job.
The production API image has its own mandatory native OCR verification; a clean
API tree alone does not prove that the separately packaged stdio image loads all
SDK files or starts with its Node permissions.

CI builds `apps/api/Dockerfile.mcp`, then runs `scripts/check-mcp-runtime.mjs`.
The client initializes the actual image over stdio, inspects the exact five read
tools and strict input schemas, checks read-only/non-destructive annotations and
verifies that `run_evaluation` is unavailable on this read-only transport.

The check uses a synthetic token/workspace and no API/provider invocation. Its
container has no network, a read-only filesystem, no Linux capabilities and no
privilege escalation; the image's normal unprivileged user and scoped Node read
permissions remain active. The entry file has its own explicit read allowance.
A 15-second deadline and transport cleanup bound the check. No image is published
and no remote service or registry credential is needed.

The native script syntax and existing SDK dependency closure were checked locally.
Because the local Docker VM is full, the new image check itself awaits its first
fresh CI result; it is not relabeled as locally passed. The previous native
stdio/protocol tests still run. Once validated, the image step is a required part
of the same release gate. Dependency versions and tool authorization are unchanged.

From the repository root, with the current workspace dependencies installed:

```bash
docker build --tag lumora-mcp:ci --file apps/api/Dockerfile.mcp .
node scripts/check-mcp-runtime.mjs
```

This is a packaging/protocol check. It does not complete real client OAuth
consent, activate minimum-privilege production credentials or prove private-tool
results without membership; those have separate acceptance criteria.
