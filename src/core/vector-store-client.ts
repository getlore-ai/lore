/**
 * Vector Store - Client & Connection Management
 *
 * Supabase client initialization, connection lifecycle, and table management.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { getValidSession } from './auth.js';

let supabase: SupabaseClient | null = null;
let supabaseMode: 'service' | 'auth' | null = null;
let supabaseTokenExpiresAt: number = 0;

/**
 * Get an authenticated Supabase client. Three modes:
 * 1. Service key (env var set) → bypasses RLS, backward compatible
 * 2. Authenticated user → publishable key + auth session token → RLS applies
 * 3. Neither → throws with helpful message
 */
export async function getSupabase(): Promise<SupabaseClient> {
  // Auto-reset cached client if token has expired (with 60s buffer)
  if (supabase && supabaseMode === 'auth') {
    const now = Math.floor(Date.now() / 1000);
    if (supabaseTokenExpiresAt > 0 && supabaseTokenExpiresAt <= now + 60) {
      supabase = null;
      supabaseMode = null;
      supabaseTokenExpiresAt = 0;
    }
  }

  if (supabase) return supabase;

  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;

  if (!url) {
    throw new Error('SUPABASE_URL is required. Run \'lore setup\' to configure.');
  }

  // Mode 1: Service key (bypasses RLS)
  if (serviceKey) {
    supabase = createClient(url, serviceKey);
    supabaseMode = 'service';
    return supabase;
  }

  // Mode 2: Authenticated user (RLS applies)
  if (publishableKey) {
    const session = await getValidSession();
    if (session) {
      supabase = createClient(url, publishableKey, {
        global: {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        },
      });
      supabaseMode = 'auth';
      supabaseTokenExpiresAt = session.expires_at;
      return supabase;
    }
  }

  // Mode 3: No auth
  throw new Error(
    'Not authenticated. Run \'lore auth login\' to sign in, or set SUPABASE_SERVICE_KEY for service mode.'
  );
}

// ============================================================================
// Index Management (compatibility layer - not needed for Supabase)
// ============================================================================

export async function indexExists(_dbPath: string): Promise<boolean> {
  // With Supabase, the index always "exists" if we can connect
  try {
    const client = await getSupabase();
    const { error } = await client.from('sources').select('id').limit(1);
    return !error;
  } catch {
    return false;
  }
}

export async function initializeTables(_dbPath: string): Promise<void> {
  // Tables are managed via migrations in Supabase
  // This is a no-op for compatibility
}

export function resetDatabaseConnection(): void {
  // Reset the client to force reconnection
  supabase = null;
  supabaseMode = null;
  supabaseTokenExpiresAt = 0;
}

export async function closeDatabase(): Promise<void> {
  supabase = null;
  supabaseMode = null;
  supabaseTokenExpiresAt = 0;
}

// For compatibility - Supabase doesn't use a local path
export async function getDatabase(_dbPath: string): Promise<SupabaseClient> {
  return await getSupabase();
}
