/**
 * Lore - User Settings (Supabase key-value store)
 *
 * Generic per-user settings stored in Supabase for cross-machine discovery.
 * Uses the user_settings table with RLS for data isolation.
 */

import { getSupabase } from './vector-store.js';

// ============================================================================
// Well-known setting keys
// ============================================================================

export const SETTING_DATA_REPO_URL = 'data_repo_url';

// ============================================================================
// CRUD
// ============================================================================

/**
 * Get a user setting by key. Returns null if not found.
 */
export async function getUserSetting(key: string): Promise<string | null> {
  const client = await getSupabase();

  const { data, error } = await client
    .from('user_settings')
    .select('value')
    .eq('key', key)
    .single();

  if (error || !data) {
    return null;
  }

  return data.value;
}

/**
 * Set a user setting (upsert). Creates or updates the value for the given key.
 */
export async function setUserSetting(key: string, value: string): Promise<void> {
  const client = await getSupabase();

  const { error } = await client
    .from('user_settings')
    .upsert(
      { key, value, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,key' }
    );

  if (error) {
    console.error(`[setUserSetting] Error setting '${key}':`, error);
    throw error;
  }
}
