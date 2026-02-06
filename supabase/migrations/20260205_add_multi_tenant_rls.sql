-- Multi-tenant RLS: Add user_id columns and row-level security policies
-- Enables data isolation per authenticated user while preserving service key bypass.

-- Add user_id to both tables (defaults to current auth user on insert)
ALTER TABLE sources ADD COLUMN IF NOT EXISTS user_id UUID DEFAULT auth.uid();
ALTER TABLE chunks ADD COLUMN IF NOT EXISTS user_id UUID DEFAULT auth.uid();

-- Replace global content_hash unique index with per-user uniqueness
DROP INDEX IF EXISTS idx_sources_content_hash;
CREATE UNIQUE INDEX idx_sources_content_hash_per_user
  ON sources(user_id, content_hash) WHERE content_hash IS NOT NULL;

-- Performance indexes for user-scoped queries
CREATE INDEX IF NOT EXISTS idx_sources_user_id ON sources(user_id);
CREATE INDEX IF NOT EXISTS idx_chunks_user_id ON chunks(user_id);

-- Enable RLS on both tables
ALTER TABLE sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE chunks ENABLE ROW LEVEL SECURITY;

-- Sources policies (SELECT, INSERT, UPDATE, DELETE)
CREATE POLICY sources_select_own ON sources FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY sources_insert_own ON sources FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY sources_update_own ON sources FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY sources_delete_own ON sources FOR DELETE USING (auth.uid() = user_id);

-- Chunks policies (SELECT, INSERT, UPDATE, DELETE)
CREATE POLICY chunks_select_own ON chunks FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY chunks_insert_own ON chunks FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY chunks_update_own ON chunks FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY chunks_delete_own ON chunks FOR DELETE USING (auth.uid() = user_id);

-- ============================================================================
-- Claim unclaimed data (SECURITY DEFINER to bypass RLS)
-- Allows an authenticated user to claim rows with user_id IS NULL.
-- This is a one-time migration helper for existing single-user data.
-- ============================================================================
CREATE OR REPLACE FUNCTION claim_unclaimed_data()
RETURNS TABLE(sources_claimed BIGINT, chunks_claimed BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  sc BIGINT;
  cc BIGINT;
BEGIN
  -- Only works for authenticated users
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Must be authenticated to claim data';
  END IF;

  UPDATE sources SET user_id = auth.uid() WHERE user_id IS NULL;
  GET DIAGNOSTICS sc = ROW_COUNT;

  UPDATE chunks SET user_id = auth.uid() WHERE user_id IS NULL;
  GET DIAGNOSTICS cc = ROW_COUNT;

  RETURN QUERY SELECT sc, cc;
END;
$$;
