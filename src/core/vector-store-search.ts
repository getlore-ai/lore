/**
 * Vector Store - Search Operations
 *
 * Semantic, keyword, and hybrid search across sources.
 */

import type {
  SourceType,
  ContentType,
  SearchMode,
  Quote,
  Theme,
} from './types.js';
import { getSupabase } from './vector-store-client.js';

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

/**
 * Get a count of sources matching filters (no data fetched).
 */
export async function getSourceCount(
  _dbPath: string,
  options: { project?: string; source_type?: SourceType; exclude_source_type?: string } = {}
): Promise<number> {
  const { project, source_type, exclude_source_type } = options;
  const client = await getSupabase();

  let query = client
    .from('sources')
    .select('*', { count: 'exact', head: true })
    .is('deleted_at', null);

  if (source_type) {
    query = query.eq('source_type', source_type);
  }

  if (exclude_source_type) {
    query = query.neq('source_type', exclude_source_type);
  }

  if (project) {
    query = query.contains('projects', [project]);
  }

  const { count, error } = await query;

  if (error) {
    console.error('Error getting source count:', error);
    return 0;
  }

  return count || 0;
}
