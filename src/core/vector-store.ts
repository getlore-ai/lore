/**
 * Lore - Vector Store (Supabase + pgvector)
 *
 * Cloud-hosted vector storage for semantic search across sources and chunks.
 * Replaces LanceDB for multi-machine, multi-agent support.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type {
  SourceRecord,
  Quote,
  Theme,
  SourceType,
  ContentType,
} from './types.js';

let supabase: SupabaseClient | null = null;

function getSupabase(): SupabaseClient {
  if (!supabase) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

    if (!url || !key) {
      throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY (or SUPABASE_ANON_KEY) are required');
    }

    supabase = createClient(url, key);
  }
  return supabase;
}

// ============================================================================
// Index Management (compatibility layer - not needed for Supabase)
// ============================================================================

export async function indexExists(_dbPath: string): Promise<boolean> {
  // With Supabase, the index always "exists" if we can connect
  try {
    const client = getSupabase();
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
}

export async function closeDatabase(): Promise<void> {
  supabase = null;
}

// For compatibility - Supabase doesn't use a local path
export async function getDatabase(_dbPath: string): Promise<SupabaseClient> {
  return getSupabase();
}

// ============================================================================
// Source Storage
// ============================================================================

export async function addSource(
  _dbPath: string,
  source: SourceRecord,
  vector: number[],
  extras?: {
    content_hash?: string;
    source_path?: string;
  }
): Promise<void> {
  const client = getSupabase();

  const record: Record<string, unknown> = {
    id: source.id,
    title: source.title,
    source_type: source.source_type,
    content_type: source.content_type,
    projects: JSON.parse(source.projects),
    tags: JSON.parse(source.tags),
    created_at: source.created_at,
    summary: source.summary,
    themes_json: JSON.parse(source.themes_json),
    quotes_json: JSON.parse(source.quotes_json),
    has_full_content: source.has_full_content,
    embedding: vector,
    indexed_at: new Date().toISOString(),
  };

  // Add optional dedup and metadata fields
  if (extras?.content_hash) {
    record.content_hash = extras.content_hash;
  }
  if (extras?.source_path) {
    record.source_path = extras.source_path;
  }

  const { error } = await client.from('sources').upsert(record);

  if (error) {
    console.error('[addSource] Error:', error);
    throw error;
  }
}

export async function storeSources(
  _dbPath: string,
  sources: Array<{
    source: SourceRecord;
    vector: number[];
    extras?: {
      content_hash?: string;
      source_path?: string;
    };
  }>
): Promise<void> {
  const client = getSupabase();

  const records = sources.map(({ source, vector, extras }) => {
    const record: Record<string, unknown> = {
      id: source.id,
      title: source.title,
      source_type: source.source_type,
      content_type: source.content_type,
      projects: JSON.parse(source.projects),
      tags: JSON.parse(source.tags),
      created_at: source.created_at,
      summary: source.summary,
      themes_json: JSON.parse(source.themes_json),
      quotes_json: JSON.parse(source.quotes_json),
      has_full_content: source.has_full_content,
      embedding: vector,
      indexed_at: new Date().toISOString(),
    };

    if (extras?.content_hash) {
      record.content_hash = extras.content_hash;
    }
    if (extras?.source_path) {
      record.source_path = extras.source_path;
    }

    return record;
  });

  const { error } = await client.from('sources').upsert(records);

  if (error) {
    console.error('[storeSources] Error:', error);
    throw error;
  }
}

// ============================================================================
// Content Hash Operations (for deduplication)
// ============================================================================

export async function checkContentHashExists(
  _dbPath: string,
  contentHash: string
): Promise<boolean> {
  const client = getSupabase();

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

  const client = getSupabase();
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

// ============================================================================
// Search Operations
// ============================================================================

export async function searchSources(
  _dbPath: string,
  queryVector: number[],
  options: {
    limit?: number;
    project?: string;
    source_type?: SourceType;
    content_type?: ContentType;
    recency_boost?: number;
  } = {}
): Promise<
  Array<{
    id: string;
    title: string;
    source_type: SourceType;
    content_type: ContentType;
    projects: string[];
    tags: string[];
    created_at: string;
    summary: string;
    themes: Theme[];
    quotes: Quote[];
    score: number;
  }>
> {
  const { limit = 10, project, source_type, content_type, recency_boost = 0.15 } = options;
  const client = getSupabase();

  const { data, error } = await client.rpc('search_sources', {
    query_embedding: queryVector,
    match_count: limit,
    filter_project: project || null,
    filter_source_type: source_type || null,
    filter_content_type: content_type || null,
    recency_boost,
  });

  if (error) {
    console.error('Error searching sources:', error);
    return [];
  }

  return (data || []).map((row: Record<string, unknown>) => ({
    id: row.id as string,
    title: row.title as string,
    source_type: row.source_type as SourceType,
    content_type: row.content_type as ContentType,
    projects: row.projects as string[],
    tags: row.tags as string[],
    created_at: row.created_at as string,
    summary: row.summary as string,
    themes: (row.themes_json || []) as Theme[],
    quotes: (row.quotes_json || []) as Quote[],
    score: row.score as number,
  }));
}

// ============================================================================
// Retrieval Operations
// ============================================================================

export async function getAllSources(
  _dbPath: string,
  options: {
    project?: string;
    source_type?: SourceType;
    limit?: number;
  } = {}
): Promise<
  Array<{
    id: string;
    title: string;
    source_type: SourceType;
    content_type: ContentType;
    projects: string[];
    created_at: string;
    summary: string;
  }>
> {
  const { project, source_type, limit } = options;
  const client = getSupabase();

  let query = client
    .from('sources')
    .select('id, title, source_type, content_type, projects, created_at, summary')
    .order('created_at', { ascending: false });

  if (source_type) {
    query = query.eq('source_type', source_type);
  }

  if (project) {
    query = query.contains('projects', [project]);
  }

  if (limit) {
    query = query.limit(limit);
  }

  const { data, error } = await query;

  if (error) {
    console.error('Error getting all sources:', error);
    return [];
  }

  return (data || []).map((row) => ({
    id: row.id,
    title: row.title,
    source_type: row.source_type as SourceType,
    content_type: row.content_type as ContentType,
    projects: row.projects,
    created_at: row.created_at,
    summary: row.summary,
  }));
}

export async function getSourceById(
  _dbPath: string,
  sourceId: string
): Promise<{
  id: string;
  title: string;
  source_type: SourceType;
  content_type: ContentType;
  projects: string[];
  tags: string[];
  created_at: string;
  summary: string;
  themes: Theme[];
  quotes: Quote[];
} | null> {
  const client = getSupabase();

  const { data, error } = await client
    .from('sources')
    .select('*')
    .eq('id', sourceId)
    .single();

  if (error || !data) {
    console.error('Error getting source by ID:', error);
    return null;
  }

  return {
    id: data.id,
    title: data.title,
    source_type: data.source_type as SourceType,
    content_type: data.content_type as ContentType,
    projects: data.projects,
    tags: data.tags,
    created_at: data.created_at,
    summary: data.summary,
    themes: data.themes_json || [],
    quotes: data.quotes_json || [],
  };
}

// ============================================================================
// Statistics
// ============================================================================

export async function getThemeStats(
  _dbPath: string,
  project?: string
): Promise<Map<string, { source_count: number; quote_count: number }>> {
  const client = getSupabase();
  const stats = new Map<string, { source_count: number; quote_count: number }>();

  let query = client.from('sources').select('themes_json, quotes_json, projects');

  if (project) {
    query = query.contains('projects', [project]);
  }

  const { data, error } = await query;

  if (error) {
    console.error('Error getting theme stats:', error);
    return stats;
  }

  for (const row of data || []) {
    const themes = (row.themes_json || []) as Theme[];
    for (const theme of themes) {
      const existing = stats.get(theme.name) || { source_count: 0, quote_count: 0 };
      existing.source_count++;
      existing.quote_count += theme.evidence?.length || 0;
      stats.set(theme.name, existing);
    }
  }

  return stats;
}

export async function getProjectStats(
  _dbPath: string
): Promise<
  Array<{
    project: string;
    source_count: number;
    quote_count: number;
    latest_activity: string;
  }>
> {
  const client = getSupabase();
  const projectMap = new Map<
    string,
    { source_count: number; quote_count: number; latest_activity: string }
  >();

  const { data, error } = await client
    .from('sources')
    .select('projects, quotes_json, created_at');

  if (error) {
    console.error('Error getting project stats:', error);
    return [];
  }

  for (const row of data || []) {
    const projects = row.projects as string[];
    const quotes = (row.quotes_json || []) as Quote[];
    const created_at = row.created_at as string;

    for (const project of projects) {
      const existing = projectMap.get(project) || {
        source_count: 0,
        quote_count: 0,
        latest_activity: created_at,
      };
      existing.source_count++;
      existing.quote_count += quotes.length;
      if (new Date(created_at) > new Date(existing.latest_activity)) {
        existing.latest_activity = created_at;
      }
      projectMap.set(project, existing);
    }
  }

  return Array.from(projectMap.entries())
    .map(([project, stats]) => ({ project, ...stats }))
    .sort((a, b) => new Date(b.latest_activity).getTime() - new Date(a.latest_activity).getTime());
}
