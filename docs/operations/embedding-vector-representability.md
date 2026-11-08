# BE-12 provider vector representability

## Finding and bounded plan

The shared provider decoder at `f05105d` checks dimensions first and finite
JavaScript numbers, but currently accepts an all-zero vector and finite values
outside float32 range. The former cannot define cosine similarity; the latter
can fail when stored in pgvector. Float64 values that all underflow to zero in
float32 have the same zero-norm problem. This is a reproducible decoder gap,
not a claim that a real provider currently returns these values in production.

The official [vector type reference](https://github.com/pgvector/pgvector#vector-type)
documents finite single-precision coordinates; its
[index guidance](https://github.com/pgvector/pgvector#why-are-there-less-results-for-a-query-after-adding-an-hnsw-index)
states that zero vectors are not indexed for cosine distance. The
[versioned input implementation](https://github.com/pgvector/pgvector/blob/v0.8.7/src/vector.c)
also distinguishes overflow from coordinates that round to zero. These checks
do not prove that all possible finite vectors are numerically well-conditioned
or semantically useful.

The explicit workspace reindex path already checks finite/nonzero float32
representability in `validateWorkspaceEmbedding`. Keep provider decoding usable
with its configured dimension, including small synthetic vectors in tests:
do not import the fixed-1024 reindex assertion into the generic decoder.

Add a small check after the existing dimension-first bounded array decode:
every coordinate must remain finite under Math.fround and at least one must
remain nonzero. Preserve valid zero coordinates, negative values, sparse vectors
and the original returned values; this is validation, not normalization or a
model/index migration. Reuse the existing fixed invalid_response failure.
No dependency, SQL, pricing, prompt, provider selection or index change.

Native provider usage is currently observed before vector decoding. Keep that
ordering, so a remotely charged invalid response is still accounted for.
No call to a paid provider is needed to validate the change. Do not rewrite or
pretend to repair historical stored vectors or cache entries.

## Acceptance

- A before-change fixture reproduces acceptance of zero/overflow/underflow
  vectors; after the fix those values fail with safe fixed diagnostics.
- Dimension checks still run before inspecting array elements. All three current
  provider adapters inherit the check and retain native usage on failed output.
- Valid nonzero vectors, including sparse/negative coordinates, retain their
  existing numerical values. No normalization or rounding is returned.
- Focused cases, complete harness, both graphs, fresh actual SQL/image/UX gates
  and observed publication must pass before marking the increment delivered.

## Status

The before-change fixture accepted all three zero/overflow/underflow cases.
The focused regression initially failed five of nine cases, demonstrating the
gap across the shared decoder and all three adapters. After the bounded fix,
16 focused provider/index/MCP-budget cases pass. Valid usage is retained for
each rejected adapter response. All seven final combined harness checks and both
graphs pass locally (453/1,809 structural modules/dependencies, 452/1,314 runtime).
The optional model-performance gate is not executed. Fresh actual SQL/image/UX
CI and combined publication also passed at `577e500`: 99 SQL cases, all four
normal gates, both short image-based paths, both observed live services and
public checks. See the [combined receipt](release-2026-11-08-oauth-vector-boundaries.md).

A disposable SQL-only fixture checks actual float32 conversion, zero-vector
cosine NaN and overflow rejection, then proves the connection remains usable.
It writes no record and calls no provider. This proves the numerical boundary,
not answer quality or historical data repair.
