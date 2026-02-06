/**
 * Lore - Centralized Config Loader
 *
 * Loads configuration from ~/.config/lore/config.json with env var overrides.
 * Resolution order: process.env > config.json > error
 *
 * Service key (SUPABASE_SERVICE_KEY) is env-only and never stored in config.
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import os from 'os';

// ============================================================================
// Types
// ============================================================================

export interface LoreConfig {
  version: number;
  supabase_url?: string;
  supabase_publishable_key?: string;
  /** @deprecated Use supabase_publishable_key instead */
  supabase_anon_key?: string;
  openai_api_key?: string;
  anthropic_api_key?: string;
}

export interface ResolvedConfig {
  supabaseUrl?: string;
  supabasePublishableKey?: string;
  openaiApiKey?: string;
  anthropicApiKey?: string;
}

// ============================================================================
// Hosted Service Defaults (public, safe to ship — RLS protects data)
// ============================================================================

const DEFAULT_SUPABASE_URL = 'https://lyuykpxsntxixsdrkjya.supabase.co';
const DEFAULT_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_EXHW5HwqNmiiXkhZ7eYIqQ_l1xqfNpa';

// ============================================================================
// Paths
// ============================================================================

const CONFIG_DIR = path.join(os.homedir(), '.config', 'lore');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

export function getLoreConfigPath(): string {
  return CONFIG_FILE;
}

export function getLoreConfigDir(): string {
  return CONFIG_DIR;
}

// ============================================================================
// Config Loading
// ============================================================================

/**
 * Load config from disk. Returns null if config file doesn't exist.
 */
async function loadConfigFile(): Promise<LoreConfig | null> {
  if (!existsSync(CONFIG_FILE)) {
    return null;
  }

  try {
    const content = await readFile(CONFIG_FILE, 'utf-8');
    return JSON.parse(content) as LoreConfig;
  } catch {
    return null;
  }
}

/**
 * Load resolved config: process.env takes precedence over config.json.
 */
export async function loadLoreConfig(): Promise<ResolvedConfig> {
  const file = await loadConfigFile();

  return {
    supabaseUrl: process.env.SUPABASE_URL || file?.supabase_url || DEFAULT_SUPABASE_URL,
    supabasePublishableKey: process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || file?.supabase_publishable_key || file?.supabase_anon_key || DEFAULT_SUPABASE_PUBLISHABLE_KEY,
    openaiApiKey: process.env.OPENAI_API_KEY || file?.openai_api_key,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY || file?.anthropic_api_key,
  };
}

/**
 * Save config to disk. Only saves non-sensitive keys.
 * Service key (SUPABASE_SERVICE_KEY) is never stored.
 */
export async function saveLoreConfig(config: Partial<LoreConfig>): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true });

  // Merge with existing config
  const existing = await loadConfigFile();
  const merged: LoreConfig = {
    version: 1,
    ...existing,
    ...config,
  };

  await writeFile(CONFIG_FILE, JSON.stringify(merged, null, 2) + '\n');
}

/**
 * Bridge config values into process.env for backward compatibility.
 * Only sets env vars that aren't already set (env takes precedence).
 */
export async function bridgeConfigToEnv(): Promise<void> {
  const config = await loadLoreConfig();

  if (config.supabaseUrl && !process.env.SUPABASE_URL) {
    process.env.SUPABASE_URL = config.supabaseUrl;
  }
  if (config.supabasePublishableKey && !process.env.SUPABASE_PUBLISHABLE_KEY) {
    process.env.SUPABASE_PUBLISHABLE_KEY = config.supabasePublishableKey;
  }
  if (config.openaiApiKey && !process.env.OPENAI_API_KEY) {
    process.env.OPENAI_API_KEY = config.openaiApiKey;
  }
  if (config.anthropicApiKey && !process.env.ANTHROPIC_API_KEY) {
    process.env.ANTHROPIC_API_KEY = config.anthropicApiKey;
  }
}
