# RAG Fundamentals

RAG means Retrieval-Augmented Generation. The system first retrieves passages
from a knowledge base, then provides those passages as context to a model that
generates a grounded answer.

Embeddings represent text as numerical vectors. Semantic search compares the
direction of a question vector with chunk vectors. In this project, pgvector
uses cosine distance and converts it into a similarity score.

Chunking divides long documents into smaller pieces. A small overlap preserves
an idea that crosses a chunk boundary, while excessive overlap causes duplicate
context and unnecessary embedding cost.

The HNSW index accelerates approximate nearest-neighbor search. It trades a small
chance of missing the exact best neighbor for lower latency in large collections.
Quality must be measured with real questions and a golden set.

Retrieved documents are untrusted data. Instructions inside them must not change
the system role, authorize actions, or replace security rules.
