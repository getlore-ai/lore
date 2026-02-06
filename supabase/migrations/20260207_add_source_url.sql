-- Add source_url and source_name columns for citation linking
-- source_url: Original URL (Slack permalink, Notion page, GitHub issue, etc.)
-- source_name: Human-readable origin label ("Slack #product-team", "GitHub issue #42")

ALTER TABLE sources ADD COLUMN IF NOT EXISTS source_url TEXT;
ALTER TABLE sources ADD COLUMN IF NOT EXISTS source_name TEXT;
