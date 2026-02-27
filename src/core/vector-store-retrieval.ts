/**
 * Vector Store - Retrieval Operations
 *
 * Getting, updating, and deleting individual sources.
 */

import type {
  SourceType,
  ContentType,
  Quote,
  Theme,
} from './types.js';
import { getSupabase } from './vector-store-client.js';

/**
 * Get all source IDs. Paginates to avoid Supabase's default 1000-row limit.
 */
export async function getAllSourceIds(_dbPath: string): Promise<Set<string>> {
  const client = await getSupabase();
  const ids = new Set<string>();
  const pageSize = 1000;
  let offset = 0;

  while (true) {
    const { data, error } = await client
      .from('sources')
      .select('id')
      .range(offset, offset + pageSize - 1);

    if (error) {
      console.error('Error getting source IDs:', error);
      break;
    }

    if (!data || data.length === 0) break;

    for (const row of data) {
      ids.add(row.id);
    }

    if (data.length < pageSize) break;
    offset += pageSize;
  }

  return ids;
}

export async function getAllSources(
  _dbPath: string,
  options: {
    project?: string;
    source_type?: SourceType;
    exclude_source_type?: string;
    limit?: number;
    sort_by?: 'indexed_at' | 'created_at';
  } = {}
): Promise<
  Array<{
    id: string;
    title: string;
    source_type: SourceType;
    content_type: ContentType;
    projects: string[];
    created_at: string;
    indexed_at: string;
    summary: string;
  }>
> {
  const { project, source_type, exclude_source_type, limit, sort_by = 'indexed_at' } = options;
  const client = await getSupabase();

  let query = client
    .from('sources')
    .select('id, title, source_type, content_type, projects, created_at, indexed_at, summary')
    .order(sort_by, { ascending: false });

  if (source_type) {
    query = query.eq('source_type', source_type);
  }

  if (exclude_source_type) {
    query = query.neq('source_type', exclude_source_type);
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
    indexed_at: row.indexed_at || row.created_at,
    summary: row.summary,
  }));
}

/**
 * Get all sources that have a source_path set.
 * Used by reconciliation to ensure local content.md files exist.
 */
export async function getSourcesWithPaths(
  _dbPath: string
): Promise<
  Array<{
    id: string;
    title: string;
    summary: string;
    source_path: string;
  }>
> {
  const client = await getSupabase();

  const { data, error } = await client
    .from('sources')
    .select('id, title, summary, source_path')
    .not('source_path', 'is', null);

  if (error) {
    console.error('Error getting sources with paths:', error);
    return [];
  }

  return (data || [])
    .filter((row) => row.source_path)
    .map((row) => ({
      id: row.id,
      title: row.title,
      summary: row.summary || '',
      source_path: row.source_path,
    }));
}

/**
 * Get content for specific sources from the database.
 * Returns a map of source ID → content string.
 * Only fetches content for the provided IDs to avoid unbounded queries.
 */
export async function getSourceContentMap(
  _dbPath: string,
  sourceIds: string[]
): Promise<Map<string, string>> {
  const client = await getSupabase();
  const contentMap = new Map<string, string>();

  if (sourceIds.length === 0) return contentMap;

  // Fetch in batches of 50 to stay within Supabase payload limits
  const batchSize = 50;
  for (let i = 0; i < sourceIds.length; i += batchSize) {
    const batch = sourceIds.slice(i, i + batchSize);
    const { data, error } = await client
      .from('sources')
      .select('id, content')
      .in('id', batch)
      .not('content', 'is', null);

    if (error) {
      console.error('Error getting source content map:', error);
      continue;
    }

    for (const row of data || []) {
      if (row.id && row.content) {
        contentMap.set(row.id, row.content);
      }
    }
  }

  return contentMap;
}

/**
 * Get source IDs that do NOT have content stored in the cloud.
 * Used by reconciliation to identify sources needing backfill.
 */
export async function getSourceIdsWithoutContent(
  _dbPath: string
): Promise<Set<string>> {
  const client = await getSupabase();
  // Limit to 200 per sync cycle to avoid large payloads and long backfill runs
  const { data, error } = await client
    .from('sources')
    .select('id')
    .is('content', null)
    .limit(200);

  if (error) {
    console.error('Error getting sources without content:', error);
    return new Set();
  }

  return new Set((data || []).map((row) => row.id));
}

/**
 * Backfill content for existing sources that don't have cloud content.
 * Used to push local content to Lore Cloud for pre-feature sources.
 */
export async function backfillSourceContent(
  _dbPath: string,
  updates: Array<{ id: string; content: string }>
): Promise<number> {
  if (updates.length === 0) return 0;

  const client = await getSupabase();
  let backfilled = 0;

  for (const { id, content } of updates) {
    const size = Buffer.byteLength(content, 'utf-8');
    if (size > 500 * 1024) continue; // Skip oversized content

    const { error } = await client
      .from('sources')
      .update({ content, content_size: size })
      .eq('id', id)
      .is('content', null); // Only update if still NULL (no race)

    if (error) {
      console.error(`[backfillSourceContent] Error updating ${id}:`, error.message);
    } else {
      backfilled++;
    }
  }

  return backfilled;
}

/**
 * Get content sizes for sources in a project (lightweight — no content transferred).
 * Used to estimate total content size before deciding on chunking strategy.
 */
export async function getSourceContentSizes(
  _dbPath: string,
  options: { project?: string } = {}
): Promise<Map<string, number>> {
  const client = await getSupabase();
  const sizes = new Map<string, number>();
  const { project } = options;
  const pageSize = 1000;
  let offset = 0;

  while (true) {
    let query = client
      .from('sources')
      .select('id, content_size')
      .not('content', 'is', null)
      .range(offset, offset + pageSize - 1);

    if (project) {
      query = query.contains('projects', [project]);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error getting source content sizes:', error);
      break;
    }

    if (!data || data.length === 0) break;

    for (const row of data) {
      if (row.id && row.content_size) {
        sizes.set(row.id, row.content_size);
      }
    }

    if (data.length < pageSize) break;
    offset += pageSize;
  }

  return sizes;
}

export async function getSourceById(
  _dbPath: string,
  sourceId: string,
  options?: { includeContent?: boolean }
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
  source_url?: string;
  source_name?: string;
  source_path?: string;
  content?: string;
  content_size?: number;
} | null> {
  const client = await getSupabase();

  // Exclude the large content column by default
  const columns = options?.includeContent
    ? 'id, title, source_type, content_type, projects, tags, created_at, summary, themes_json, quotes_json, source_url, source_name, source_path, content, content_size'
    : 'id, title, source_type, content_type, projects, tags, created_at, summary, themes_json, quotes_json, source_url, source_name, source_path';

  const { data, error } = await client
    .from('sources')
    .select(columns)
    .eq('id', sourceId)
    .single();

  if (error || !data) {
    console.error('Error getting source by ID:', error);
    return null;
  }

  const row = data as unknown as Record<string, unknown>;

  return {
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
    source_url: (row.source_url as string) || undefined,
    source_name: (row.source_name as string) || undefined,
    source_path: (row.source_path as string) || undefined,
    ...(options?.includeContent ? {
      content: (row.content as string) || undefined,
      content_size: (row.content_size as number) || undefined,
    } : {}),
  };
}

/**
 * Resolve a source ID or prefix to a full UUID.
 * Accepts full UUIDs or prefixes (min 8 chars). Returns null if not found or ambiguous.
 */
export async function resolveSourceId(
  _dbPath: string,
  idOrPrefix: string
): Promise<string | null> {
  const client = await getSupabase();

  // Try exact match first
  const { data: exact } = await client
    .from('sources')
    .select('id')
    .eq('id', idOrPrefix)
    .maybeSingle();

  if (exact) return exact.id;

  // Try prefix match (min 8 chars to avoid too many matches)
  if (idOrPrefix.length >= 8 && idOrPrefix.length < 36) {
    const { data: prefixMatches } = await client
      .from('sources')
      .select('id')
      .like('id', `${idOrPrefix}%`)
      .limit(2);

    if (prefixMatches?.length === 1) return prefixMatches[0].id;
    if (prefixMatches && prefixMatches.length > 1) {
      console.error(`Ambiguous ID prefix "${idOrPrefix}" matches multiple sources.`);
      return null;
    }
  }

  return null;
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
 * Update a source's content and re-embed for search.
 * Used by log update to fix content while preserving the original timestamp.
 */
export async function updateSourceContent(
  _dbPath: string,
  sourceId: string,
  content: string,
  embedding: number[]
): Promise<boolean> {
  const client = await getSupabase();
  const contentSize = Buffer.byteLength(content, 'utf-8');
  const contentHash = (await import('crypto')).createHash('sha256').update(content).digest('hex');

  const { error } = await client
    .from('sources')
    .update({
      content,
      content_size: contentSize,
      content_hash: contentHash,
      summary: content,
      embedding,
    })
    .eq('id', sourceId);

  if (error) {
    if ((error as any).code === '23505') {
      console.error('Error updating source content: another source already has identical content');
    } else {
      console.error('Error updating source content:', error);
    }
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
