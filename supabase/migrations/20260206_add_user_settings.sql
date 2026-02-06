-- User settings: generic key-value store for per-user settings
-- Used for cross-machine discovery (e.g., storing data repo URL)

CREATE TABLE IF NOT EXISTS user_settings (
  user_id UUID NOT NULL DEFAULT auth.uid(),
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, key)
);

-- Performance index
CREATE INDEX IF NOT EXISTS idx_user_settings_user_id ON user_settings(user_id);

-- Enable RLS
ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;

-- RLS policies (matching sources/chunks pattern)
CREATE POLICY user_settings_select_own ON user_settings FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY user_settings_insert_own ON user_settings FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY user_settings_update_own ON user_settings FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY user_settings_delete_own ON user_settings FOR DELETE USING (auth.uid() = user_id);
