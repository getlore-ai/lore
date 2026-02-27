/**
 * Vector Store - Lookup Operations
 *
 * Path-based lookups and content hash deduplication checks.
 */

import { getSupabase } from './vector-store-client.js';

// ============================================================================
// Source Path Operations (for edit detection)
// ============================================================================

export async function findSourceByPath(
  _dbPath: string,
  sourcePath: string
): Promise<{ id: string; content_hash: string } | null> {
  const client = await getSupabase();

  const { data, error } = await client
    .from('sources')
    .select('id, content_hash')
    .eq('source_path', sourcePath)
    .limit(1)
    .single();

  if (error || !data) {
    return null;
  }

  return {
    id: data.id,
    content_hash: data.content_hash,
  };
}

export async function getSourcePathMappings(
  _dbPath: string,
  paths: string[]
): Promise<Map<string, { id: string; content_hash: string }>> {
  if (paths.length === 0) return new Map();

  const client = await getSupabase();
  const mappings = new Map<string, { id: string; content_hash: string }>();

  // Query in batches
  const batchSize = 100;
  for (let i = 0; i < paths.length; i += batchSize) {
    const batch = paths.slice(i, i + batchSize);

    const { data, error } = await client
      .from('sources')
      .select('id, source_path, content_hash')
      .in('source_path', batch);

    if (error) {
      console.error('Error getting source path mappings:', error);
      continue;
    }

    for (const row of data || []) {
      if (row.source_path) {
        mappings.set(row.source_path, {
          id: row.id,
          content_hash: row.content_hash,
        });
      }
    }
  }

  return mappings;
}

// ============================================================================
// Content Hash Operations (for deduplication)
// ============================================================================

export async function checkContentHashExists(
  _dbPath: string,
  contentHash: string
): Promise<boolean> {
  const client = await getSupabase();

  const { data, error } = await client
    .from('sources')
    .select('id')
    .eq('content_hash', contentHash)
    .limit(1);

  if (error) {
    console.error('Error checking content hash:', error);
    return false;
  }

  return (data?.length || 0) > 0;
}

export async function getExistingContentHashes(
  _dbPath: string,
  hashes: string[]
): Promise<Set<string>> {
  if (hashes.length === 0) return new Set();

  const client = await getSupabase();
  const existing = new Set<string>();

  // Query in batches to avoid limits
  const batchSize = 100;
  for (let i = 0; i < hashes.length; i += batchSize) {
    const batch = hashes.slice(i, i + batchSize);

    const { data, error } = await client
      .from('sources')
      .select('content_hash')
      .in('content_hash', batch);

    if (error) {
      console.error('Error checking content hashes:', error);
      continue;
    }

    for (const row of data || []) {
      if (row.content_hash) {
        existing.add(row.content_hash);
      }
    }
  }

  return existing;
}
