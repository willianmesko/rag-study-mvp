-- The first study corpus and UI are Portuguese. This configuration removes
-- Portuguese stopwords and stems inflected words, unlike `simple`.
DROP INDEX IF EXISTS chunks_search_vector_gin_idx;

ALTER TABLE chunks DROP COLUMN search_vector;

ALTER TABLE chunks
  ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (to_tsvector('portuguese', content)) STORED;

CREATE INDEX chunks_search_vector_gin_idx
  ON chunks USING gin(search_vector);
