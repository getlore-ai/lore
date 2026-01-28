/**
 * Sync Handler - Refresh knowledge repository
 *
 * Full git sync (pull + push) and indexes any new sources.
 */

import { readdir, readFile } from 'fs/promises';
import path from 'path';

import {
  getAllSources,
  addSource,
  resetDatabaseConnection,
} from '../../core/vector-store.js';
import { generateEmbedding, createSearchableText } from '../../core/embedder.js';
import { gitPull, gitCommitAndPush, hasChanges } from '../../core/git.js';
import type { SourceRecord, Theme, SourceType, ContentType } from '../../core/types.js';

interface SyncArgs {
  git_pull?: boolean;
  git_push?: boolean;
  index_new?: boolean;
}

interface SyncResult {
  git_pulled: boolean;
  git_pushed: boolean;
  git_error?: string;
  sources_found: number;
  sources_indexed: number;
  already_indexed: number;
}

/**
 * Load a source from disk
 */
async function loadSourceFromDisk(
  sourcesDir: string,
  sourceId: string
): Promise<{
  source: {
    id: string;
    title: string;
    source_type: string;
    content_type: string;
    created_at: string;
    projects: string[];
    tags: string[];
    content: string;
  };
  insights: { summary: string; themes: Theme[] };
} | null> {
  const sourceDir = path.join(sourcesDir, sourceId);

  try {
    const metadata = JSON.parse(await readFile(path.join(sourceDir, 'metadata.json'), 'utf-8'));
    const content = await readFile(path.join(sourceDir, 'content.md'), 'utf-8');

    let insights = { summary: '', themes: [] as Theme[] };
    try {
      const insightsFile = JSON.parse(await readFile(path.join(sourceDir, 'insights.json'), 'utf-8'));
      insights.summary = insightsFile.summary || '';
      insights.themes = insightsFile.themes || [];
    } catch {
      // No insights file - generate a basic summary from content
      insights.summary = content.substring(0, 500) + (content.length > 500 ? '...' : '');
    }

    return {
      source: {
        ...metadata,
        content,
      },
      insights,
    };
  } catch {
    return null;
  }
}

/**
 * Index a single source
 */
async function indexSource(
  dbPath: string,
  source: {
    id: string;
    title: string;
    source_type: string;
    content_type: string;
    created_at: string;
    projects: string[];
    tags: string[];
    content: string;
  },
  insights: { summary: string; themes: Theme[] }
): Promise<void> {
  const summary = insights.summary || source.content.substring(0, 500);

  // Generate embedding for source
  const searchableText = createSearchableText({
    type: 'summary',
    text: summary,
    project: source.projects[0],
  });
  const vector = await generateEmbedding(searchableText);

  // Create source record
  const sourceRecord: SourceRecord = {
    id: source.id,
    title: source.title,
    source_type: source.source_type as SourceType,
    content_type: source.content_type as ContentType,
    projects: JSON.stringify(source.projects),
    tags: JSON.stringify(source.tags),
    created_at: source.created_at,
    summary,
    themes_json: JSON.stringify(insights.themes || []),
    quotes_json: JSON.stringify([]),
    has_full_content: true,
    vector: [],
  };

  await addSource(dbPath, sourceRecord, vector);
}

export async function handleSync(
  dbPath: string,
  dataDir: string,
  args: SyncArgs
): Promise<SyncResult> {
  const doPull = args.git_pull !== false; // Default true
  const doPush = args.git_push !== false; // Default true
  const indexNew = args.index_new !== false; // Default true
  const sourcesDir = path.join(dataDir, 'sources');

  // Reset database connection to ensure fresh reads
  resetDatabaseConnection();

  const result: SyncResult = {
    git_pulled: false,
    git_pushed: false,
    sources_found: 0,
    sources_indexed: 0,
    already_indexed: 0,
  };

  // 1. Git pull if enabled
  if (doPull) {
    const pullResult = await gitPull(dataDir);
    result.git_pulled = pullResult.success && (pullResult.message?.includes('Pulled') || false);
    if (pullResult.error) {
      result.git_error = pullResult.error;
    }
  }

  // 2. Find unsynced sources
  if (indexNew) {
    try {
      // Get source IDs from disk
      const diskSources = await readdir(sourcesDir, { withFileTypes: true });
      const diskIds = diskSources
        .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
        .map((d) => d.name);

      result.sources_found = diskIds.length;

      // Get source IDs from index
      const indexedSources = await getAllSources(dbPath, {});
      const indexedIds = new Set(indexedSources.map((s) => s.id));
      result.already_indexed = indexedIds.size;

      // Find the difference
      const unsyncedIds = diskIds.filter((id) => !indexedIds.has(id));

      // Index unsynced sources
      if (unsyncedIds.length > 0) {
        // Note: Don't call initializeTables here - it drops existing data!
        // addSource will create tables if they don't exist

        for (const sourceId of unsyncedIds) {
          const data = await loadSourceFromDisk(sourcesDir, sourceId);
          if (data) {
            await indexSource(dbPath, data.source, data.insights);
            result.sources_indexed++;
          }
        }
      }
    } catch {
      // Sources directory doesn't exist or other error
    }
  }

  // 3. Git push if enabled and there are changes
  if (doPush) {
    const pushResult = await gitCommitAndPush(dataDir, 'Auto-sync from Lore');
    result.git_pushed = pushResult.success && (pushResult.message?.includes('pushed') || false);
  }

  return result;
}
