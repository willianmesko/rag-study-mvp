-- The first index used `simple` during the hybrid retrieval introduction. The
-- following migration switches it to the Portuguese configuration used by this UI.
ALTER TABLE chunks
  ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (to_tsvector('simple', content)) STORED;

-- The GIN index powers lexical candidate retrieval. pgvector's HNSW index
-- remains responsible for semantic candidates; RRF combines both result sets.
CREATE INDEX IF NOT EXISTS chunks_search_vector_gin_idx
  ON chunks USING gin(search_vector);
