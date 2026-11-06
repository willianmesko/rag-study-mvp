-- The browser never connects to Supabase directly in this architecture. The
-- backend uses a database connection kept only in its server environment, so
-- public Supabase roles should have no table access.
ALTER TABLE schema_migrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE chunks ENABLE ROW LEVEL SECURITY;
