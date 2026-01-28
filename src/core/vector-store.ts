/**
 * Lore - Vector Store
 *
 * LanceDB-based vector storage for semantic search across sources and chunks.
 * Adapted from granola-extractor with expanded schema for projects and citations.
 */

import * as lancedb from '@lancedb/lancedb';
import { existsSync } from 'fs';
import type {
  SourceRecord,
  ChunkRecord,
  Quote,
  Theme,
  SourceType,
  ContentType,
} from './types.js';

let db: lancedb.Connection | null = null;

export async function getDatabase(dbPath: string): Promise<lancedb.Connection> {
  if (!db) {
    db = await lancedb.connect(dbPath);
  }
  return db;
}

export async function closeDatabase(): Promise<void> {
  if (db) {
    db = null;
  }
}

const SOURCES_TABLE = 'sources';
const CHUNKS_TABLE = 'chunks';
const PROJECTS_TABLE = 'projects';
const DECISIONS_TABLE = 'decisions';

// ============================================================================
// Index Management
// ============================================================================

export async function indexExists(dbPath: string): Promise<boolean> {
  if (!existsSync(dbPath)) return false;
  try {
    const database = await getDatabase(dbPath);
    const tables = await database.tableNames();
    return tables.includes(SOURCES_TABLE) && tables.includes(CHUNKS_TABLE);
  } catch {
    return false;
  }
}

export async function initializeTables(dbPath: string): Promise<void> {
  const database = await getDatabase(dbPath);
  const existingTables = await database.tableNames();

  // Drop existing tables if they exist (for reindexing)
  for (const table of [SOURCES_TABLE, CHUNKS_TABLE]) {
    if (existingTables.includes(table)) {
      await database.dropTable(table);
    }
  }
}

// ============================================================================
// Source Storage
// ============================================================================

export async function storeSources(
  dbPath: string,
  sources: Array<{
    source: SourceRecord;
    vector: number[];
  }>
): Promise<void> {
  const database = await getDatabase(dbPath);

  const records = sources.map(({ source, vector }) => ({
    id: source.id,
    title: source.title,
    source_type: source.source_type,
    content_type: source.content_type,
    projects: source.projects,
    tags: source.tags,
    created_at: source.created_at,
    summary: source.summary,
    themes_json: source.themes_json,
    quotes_json: source.quotes_json,
    has_full_content: source.has_full_content,
    vector,
  }));

  await database.createTable(SOURCES_TABLE, records, { mode: 'overwrite' });
}

export async function storeChunks(
  dbPath: string,
  chunks: ChunkRecord[]
): Promise<void> {
  const database = await getDatabase(dbPath);

  const records = chunks.map((chunk) => ({
    id: chunk.id,
    source_id: chunk.source_id,
    content: chunk.content,
    type: chunk.type,
    theme_name: chunk.theme_name || '',
    speaker: chunk.speaker || '',
    timestamp: chunk.timestamp || '',
    vector: chunk.vector,
  }));

  await database.createTable(CHUNKS_TABLE, records, { mode: 'overwrite' });
}

// ============================================================================
// Search Operations
// ============================================================================

export async function searchSources(
  dbPath: string,
  queryVector: number[],
  options: {
    limit?: number;
    project?: string;
    source_type?: SourceType;
    content_type?: ContentType;
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
  const { limit = 10, project, source_type, content_type } = options;
  const database = await getDatabase(dbPath);

  try {
    const table = await database.openTable(SOURCES_TABLE);
    const query = table.search(queryVector).limit(limit * 2); // Over-fetch for filtering

    const results = await query.toArray();

    return results
      .filter((row) => {
        if (source_type && row.source_type !== source_type) return false;
        if (content_type && row.content_type !== content_type) return false;
        if (project) {
          const projects = JSON.parse(row.projects as string) as string[];
          if (!projects.some((p) => p.toLowerCase().includes(project.toLowerCase()))) {
            return false;
          }
        }
        return true;
      })
      .slice(0, limit)
      .map((row) => ({
        id: row.id as string,
        title: row.title as string,
        source_type: row.source_type as SourceType,
        content_type: row.content_type as ContentType,
        projects: JSON.parse(row.projects as string) as string[],
        tags: JSON.parse(row.tags as string) as string[],
        created_at: row.created_at as string,
        summary: row.summary as string,
        themes: JSON.parse(row.themes_json as string) as Theme[],
        quotes: JSON.parse(row.quotes_json as string) as Quote[],
        score: row._distance !== undefined ? 1 / (1 + (row._distance as number)) : 0,
      }));
  } catch (error) {
    console.error('Error searching sources:', error);
    return [];
  }
}

export async function searchChunks(
  dbPath: string,
  queryVector: number[],
  options: {
    limit?: number;
    type?: ChunkRecord['type'];
    theme_name?: string;
    source_id?: string;
  } = {}
): Promise<
  Array<{
    id: string;
    source_id: string;
    content: string;
    type: string;
    theme_name: string;
    speaker: string;
    timestamp: string;
    score: number;
  }>
> {
  const { limit = 20, type, theme_name, source_id } = options;
  const database = await getDatabase(dbPath);

  try {
    const table = await database.openTable(CHUNKS_TABLE);
    const query = table.search(queryVector).limit(limit * 2);

    const results = await query.toArray();

    return results
      .filter((row) => {
        if (type && row.type !== type) return false;
        if (theme_name && row.theme_name !== theme_name) return false;
        if (source_id && row.source_id !== source_id) return false;
        return true;
      })
      .slice(0, limit)
      .map((row) => ({
        id: row.id as string,
        source_id: row.source_id as string,
        content: row.content as string,
        type: row.type as string,
        theme_name: row.theme_name as string,
        speaker: row.speaker as string,
        timestamp: row.timestamp as string,
        score: row._distance !== undefined ? 1 / (1 + (row._distance as number)) : 0,
      }));
  } catch (error) {
    console.error('Error searching chunks:', error);
    return [];
  }
}

// ============================================================================
// Retrieval Operations
// ============================================================================

export async function getAllSources(
  dbPath: string,
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
  const database = await getDatabase(dbPath);

  try {
    const table = await database.openTable(SOURCES_TABLE);
    const results = await table.query().toArray();

    let filtered = results.filter((row) => {
      if (source_type && row.source_type !== source_type) return false;
      if (project) {
        const projects = JSON.parse(row.projects as string) as string[];
        if (!projects.some((p) => p.toLowerCase().includes(project.toLowerCase()))) {
          return false;
        }
      }
      return true;
    });

    // Sort by date descending
    filtered.sort(
      (a, b) =>
        new Date(b.created_at as string).getTime() -
        new Date(a.created_at as string).getTime()
    );

    if (limit) {
      filtered = filtered.slice(0, limit);
    }

    return filtered.map((row) => ({
      id: row.id as string,
      title: row.title as string,
      source_type: row.source_type as SourceType,
      content_type: row.content_type as ContentType,
      projects: JSON.parse(row.projects as string) as string[],
      created_at: row.created_at as string,
      summary: row.summary as string,
    }));
  } catch (error) {
    console.error('Error getting all sources:', error);
    return [];
  }
}

export async function getSourceById(
  dbPath: string,
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
  const database = await getDatabase(dbPath);

  try {
    const table = await database.openTable(SOURCES_TABLE);
    const results = await table.query().where(`id = '${sourceId}'`).toArray();

    if (results.length === 0) return null;

    const row = results[0];
    return {
      id: row.id as string,
      title: row.title as string,
      source_type: row.source_type as SourceType,
      content_type: row.content_type as ContentType,
      projects: JSON.parse(row.projects as string) as string[],
      tags: JSON.parse(row.tags as string) as string[],
      created_at: row.created_at as string,
      summary: row.summary as string,
      themes: JSON.parse(row.themes_json as string) as Theme[],
      quotes: JSON.parse(row.quotes_json as string) as Quote[],
    };
  } catch (error) {
    console.error('Error getting source by ID:', error);
    return null;
  }
}

// ============================================================================
// Statistics
// ============================================================================

export async function getThemeStats(
  dbPath: string,
  project?: string
): Promise<Map<string, { source_count: number; quote_count: number }>> {
  const database = await getDatabase(dbPath);
  const stats = new Map<string, { source_count: number; quote_count: number }>();

  try {
    const table = await database.openTable(SOURCES_TABLE);
    const results = await table.query().toArray();

    for (const row of results) {
      // Filter by project if specified
      if (project) {
        const projects = JSON.parse(row.projects as string) as string[];
        if (!projects.some((p) => p.toLowerCase().includes(project.toLowerCase()))) {
          continue;
        }
      }

      const themes = JSON.parse(row.themes_json as string) as Theme[];
      for (const theme of themes) {
        const existing = stats.get(theme.name) || { source_count: 0, quote_count: 0 };
        existing.source_count++;
        existing.quote_count += theme.evidence.length;
        stats.set(theme.name, existing);
      }
    }
  } catch (error) {
    console.error('Error getting theme stats:', error);
  }

  return stats;
}

export async function getProjectStats(
  dbPath: string
): Promise<
  Array<{
    project: string;
    source_count: number;
    quote_count: number;
    latest_activity: string;
  }>
> {
  const database = await getDatabase(dbPath);
  const projectMap = new Map<
    string,
    { source_count: number; quote_count: number; latest_activity: string }
  >();

  try {
    const table = await database.openTable(SOURCES_TABLE);
    const results = await table.query().toArray();

    for (const row of results) {
      const projects = JSON.parse(row.projects as string) as string[];
      const quotes = JSON.parse(row.quotes_json as string) as Quote[];
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
  } catch (error) {
    console.error('Error getting project stats:', error);
  }

  return Array.from(projectMap.entries())
    .map(([project, stats]) => ({ project, ...stats }))
    .sort((a, b) => new Date(b.latest_activity).getTime() - new Date(a.latest_activity).getTime());
}
