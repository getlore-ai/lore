-- Add content_hash column for cross-machine deduplication
-- This is the PRIMARY dedup key - same content = same hash, regardless of path or machine

ALTER TABLE sources ADD COLUMN IF NOT EXISTS content_hash TEXT;

-- Create unique index for deduplication
-- WHERE clause avoids issues with null values (legacy records without hash)
CREATE UNIQUE INDEX IF NOT EXISTS idx_sources_content_hash
ON sources(content_hash)
WHERE content_hash IS NOT NULL;

-- Add source_path column for local metadata
-- This tracks where the file came from on the ingesting machine (for debugging)
ALTER TABLE sources ADD COLUMN IF NOT EXISTS source_path TEXT;

-- Comment for documentation
COMMENT ON COLUMN sources.content_hash IS 'SHA256 hash of original file content for cross-machine deduplication';
COMMENT ON COLUMN sources.source_path IS 'Local path where file was ingested from (machine-specific, for debugging)';
