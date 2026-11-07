ALTER TABLE ai_usage_events
  ADD COLUMN IF NOT EXISTS usage_source TEXT NOT NULL DEFAULT 'estimated'
    CHECK (usage_source IN ('observed', 'estimated', 'cache', 'none')),
  ADD COLUMN IF NOT EXISTS observed_cost_usd NUMERIC(14, 8) CHECK (observed_cost_usd >= 0),
  ADD COLUMN IF NOT EXISTS prompt_version TEXT,
  ADD COLUMN IF NOT EXISTS citation_count INTEGER NOT NULL DEFAULT 0 CHECK (citation_count >= 0),
  ADD COLUMN IF NOT EXISTS safety_outcome TEXT
    CHECK (safety_outcome IN ('validated', 'refused', 'unstructured', 'cached', 'provider_failed'));
