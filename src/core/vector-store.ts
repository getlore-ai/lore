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
  SearchMode,
} from './types.js';
import { getValidSession } from './auth.js';

let supabase: SupabaseClient | null = null;
let supabaseMode: 'service' | 'auth' | null = null;

/**
 * Get an authenticated Supabase client. Three modes:
 * 1. Service key (env var set) → bypasses RLS, backward compatible
 * 2. Authenticated user → publishable key + auth session token → RLS applies
 * 3. Neither → throws with helpful message
 */
async function getSupabase(): Promise<SupabaseClient> {
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
      return supabase;
    }
  }

  // Mode 3: No auth
  throw new Error(
    'Not authenticated. Run \'lore login\' to sign in, or set SUPABASE_SERVICE_KEY for service mode.'
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
}

export async function closeDatabase(): Promise<void> {
  supabase = null;
  supabaseMode = null;
}

// For compatibility - Supabase doesn't use a local path
export async function getDatabase(_dbPath: string): Promise<SupabaseClient> {
  return await getSupabase();
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
  const client = await getSupabase();

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
  const client = await getSupabase();

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

// ============================================================================
// Search Operations
// ============================================================================

export interface SearchSourcesOptions {
  limit?: number;
  project?: string;
  source_type?: SourceType;
  content_type?: ContentType;
  recency_boost?: number;
  /** Search mode: 'semantic', 'keyword', or 'hybrid' (default) */
  mode?: SearchMode;
  /** Query text for keyword search (required for keyword/hybrid modes) */
  queryText?: string;
  /** RRF constant for hybrid search (default 60) */
  rrf_k?: number;
}

export interface SearchSourceResult {
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
  /** Rank in semantic search results (only in hybrid mode) */
  semantic_rank?: number;
  /** Rank in keyword search results (only in hybrid mode) */
  keyword_rank?: number;
}

export async function searchSources(
  _dbPath: string,
  queryVector: number[],
  options: SearchSourcesOptions = {}
): Promise<SearchSourceResult[]> {
  const {
    limit = 10,
    project,
    source_type,
    content_type,
    recency_boost = 0.15,
    mode = 'hybrid',
    queryText = '',
    rrf_k = 60,
  } = options;
  const client = await getSupabase();

  // For backward compatibility: use legacy search if no query text or semantic-only
  if (mode === 'semantic' || !queryText) {
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

  // Use hybrid search RPC
  const { data, error } = await client.rpc('search_sources_hybrid', {
    query_embedding: queryVector,
    query_text: queryText,
    match_count: limit,
    filter_project: project || null,
    filter_source_type: source_type || null,
    filter_content_type: content_type || null,
    recency_boost,
    search_mode: mode,
    rrf_k,
  });

  if (error) {
    // Fall back to legacy search if hybrid RPC doesn't exist
    if (error.message?.includes('function search_sources_hybrid') || error.code === '42883') {
      console.warn('Hybrid search not available, falling back to semantic search');
      return searchSources(_dbPath, queryVector, { ...options, mode: 'semantic' });
    }
    console.error('Error in hybrid search:', error);
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
    semantic_rank: row.semantic_rank as number | undefined,
    keyword_rank: row.keyword_rank as number | undefined,
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
  const client = await getSupabase();

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
  const client = await getSupabase();

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

export async function deleteSource(
  _dbPath: string,
  sourceId: string
): Promise<{ deleted: boolean; contentHash?: string; sourcePath?: string }> {
  const client = await getSupabase();

  // Fetch content_hash and source_path before deleting so callers can
  // record the hash in the blocklist and remove the original file
  const { data } = await client
    .from('sources')
    .select('content_hash, source_path')
    .eq('id', sourceId)
    .single();

  const contentHash = data?.content_hash as string | undefined;
  const sourcePath = data?.source_path as string | undefined;

  const { error } = await client
    .from('sources')
    .delete()
    .eq('id', sourceId);

  if (error) {
    console.error('Error deleting source:', error);
    return { deleted: false };
  }

  return { deleted: true, contentHash, sourcePath };
}


/**
 * Update a source's projects array
 */
export async function updateSourceProjects(
  _dbPath: string,
  sourceId: string,
  projects: string[]
): Promise<boolean> {
  const client = await getSupabase();

  const { error } = await client
    .from('sources')
    .update({ projects })
    .eq('id', sourceId);

  if (error) {
    console.error('Error updating source projects:', error);
    return false;
  }

  return true;
}

/**
 * Update a source's title
 */
export async function updateSourceTitle(
  _dbPath: string,
  sourceId: string,
  title: string
): Promise<boolean> {
  const client = await getSupabase();

  const { error } = await client
    .from('sources')
    .update({ title })
    .eq('id', sourceId);

  if (error) {
    console.error('Error updating source title:', error);
    return false;
  }

  return true;
}


/**
 * Update a source's content type
 */
export async function updateSourceContentType(
  _dbPath: string,
  sourceId: string,
  contentType: string
): Promise<boolean> {
  const client = await getSupabase();

  const { error } = await client
    .from('sources')
    .update({ content_type: contentType })
    .eq('id', sourceId);

  if (error) {
    console.error('Error updating source content type:', error);
    return false;
  }

  return true;
}

// ============================================================================
// Statistics
// ============================================================================

export async function getThemeStats(
  _dbPath: string,
  project?: string
): Promise<Map<string, { source_count: number; quote_count: number }>> {
  const client = await getSupabase();
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
  const client = await getSupabase();
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
