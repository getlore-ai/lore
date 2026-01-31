-- Fix hybrid search score display
-- The RRF score (used for ranking) is not meaningful as a percentage.
-- This update returns the semantic similarity score for display while
-- still using RRF for ordering.

CREATE OR REPLACE FUNCTION search_sources_hybrid(
  query_embedding vector(1536),
  query_text text,
  match_count int DEFAULT 10,
  filter_project text DEFAULT NULL,
  filter_source_type text DEFAULT NULL,
  filter_content_type text DEFAULT NULL,
  recency_boost float DEFAULT 0.15,
  search_mode text DEFAULT 'hybrid',
  rrf_k int DEFAULT 60
)
RETURNS TABLE (
  id text,
  title text,
  source_type text,
  content_type text,
  projects text[],
  tags text[],
  created_at timestamptz,
  summary text,
  themes_json jsonb,
  quotes_json jsonb,
  score float,
  semantic_rank int,
  keyword_rank int
) AS $$
WITH
-- Semantic search results
semantic_results AS (
  SELECT
    s.id,
    s.title,
    s.source_type,
    s.content_type,
    s.projects,
    s.tags,
    s.created_at,
    s.summary,
    s.themes_json,
    s.quotes_json,
    (1 - (s.embedding <=> query_embedding)) AS semantic_score,
    ROW_NUMBER() OVER (ORDER BY (1 - (s.embedding <=> query_embedding)) DESC) AS sem_rank
  FROM sources s
  WHERE (filter_project IS NULL OR filter_project = ANY(s.projects))
    AND (filter_source_type IS NULL OR s.source_type = filter_source_type)
    AND (filter_content_type IS NULL OR s.content_type = filter_content_type)
    AND search_mode IN ('semantic', 'hybrid')
  ORDER BY (1 - (s.embedding <=> query_embedding)) DESC
  LIMIT match_count * 3
),
-- Keyword search results
keyword_results AS (
  SELECT
    s.id,
    s.title,
    s.source_type,
    s.content_type,
    s.projects,
    s.tags,
    s.created_at,
    s.summary,
    s.themes_json,
    s.quotes_json,
    ts_rank_cd(s.search_vector, plainto_tsquery('english', query_text)) AS kw_score,
    ROW_NUMBER() OVER (ORDER BY ts_rank_cd(s.search_vector, plainto_tsquery('english', query_text)) DESC) AS kw_rank
  FROM sources s
  WHERE s.search_vector @@ plainto_tsquery('english', query_text)
    AND (filter_project IS NULL OR filter_project = ANY(s.projects))
    AND (filter_source_type IS NULL OR s.source_type = filter_source_type)
    AND (filter_content_type IS NULL OR s.content_type = filter_content_type)
    AND search_mode IN ('keyword', 'hybrid')
  ORDER BY ts_rank_cd(s.search_vector, plainto_tsquery('english', query_text)) DESC
  LIMIT match_count * 3
),
-- Fuse results using RRF
fused AS (
  SELECT
    COALESCE(sr.id, kr.id) AS id,
    COALESCE(sr.title, kr.title) AS title,
    COALESCE(sr.source_type, kr.source_type) AS source_type,
    COALESCE(sr.content_type, kr.content_type) AS content_type,
    COALESCE(sr.projects, kr.projects) AS projects,
    COALESCE(sr.tags, kr.tags) AS tags,
    COALESCE(sr.created_at, kr.created_at) AS created_at,
    COALESCE(sr.summary, kr.summary) AS summary,
    COALESCE(sr.themes_json, kr.themes_json) AS themes_json,
    COALESCE(sr.quotes_json, kr.quotes_json) AS quotes_json,
    sr.sem_rank AS semantic_rank,
    kr.kw_rank AS keyword_rank,
    -- RRF score for ordering
    CASE search_mode
      WHEN 'semantic' THEN 1.0 / (COALESCE(sr.sem_rank, 1000) + rrf_k)
      WHEN 'keyword' THEN 1.0 / (COALESCE(kr.kw_rank, 1000) + rrf_k)
      ELSE COALESCE(1.0 / (sr.sem_rank + rrf_k), 0) + COALESCE(1.0 / (kr.kw_rank + rrf_k), 0)
    END AS rrf_score,
    -- Semantic similarity score for display (0-1 range, meaningful as percentage)
    COALESCE(sr.semantic_score, 0) AS semantic_score
  FROM semantic_results sr
  FULL OUTER JOIN keyword_results kr ON sr.id = kr.id
)
SELECT
  f.id,
  f.title,
  f.source_type,
  f.content_type,
  f.projects,
  f.tags,
  f.created_at,
  f.summary,
  f.themes_json,
  f.quotes_json,
  -- Use semantic similarity for display score (meaningful %), RRF for ordering
  CASE search_mode
    WHEN 'keyword' THEN f.rrf_score * 30  -- Scale keyword-only to ~0-1 range
    ELSE f.semantic_score  -- Use actual similarity for semantic/hybrid
  END AS score,
  f.semantic_rank::int,
  f.keyword_rank::int
FROM fused f
ORDER BY f.rrf_score DESC
LIMIT match_count;
$$ LANGUAGE SQL STABLE;
