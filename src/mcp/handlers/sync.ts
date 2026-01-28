/**
 * Sync Handler - Universal file sync with two-phase processing
 *
 * Phase 1: Discovery (NO LLM calls - essentially free)
 *   - Scan configured directories
 *   - Compute content hashes
 *   - Check Supabase for existing hashes
 *
 * Phase 2: Processing (only for NEW files)
 *   - Claude extracts metadata
 *   - Generate embeddings
 *   - Store in Supabase + local data dir
 */

import { readdir, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

import {
  getAllSources,
  addSource,
  resetDatabaseConnection,
} from '../../core/vector-store.js';
import { generateEmbedding, createSearchableText } from '../../core/embedder.js';
import { gitPull, gitCommitAndPush } from '../../core/git.js';
import type { SourceRecord, Theme, SourceType, ContentType } from '../../core/types.js';

import { loadSyncConfig, getEnabledSources } from '../../sync/config.js';
import { discoverAllSources, summarizeDiscovery, type DiscoveryResult } from '../../sync/discover.js';
import { processFiles, type ProcessResult } from '../../sync/process.js';

// ============================================================================
// Types
// ============================================================================

interface SyncArgs {
  git_pull?: boolean;
  git_push?: boolean;
  index_new?: boolean;
  dry_run?: boolean;
  use_legacy?: boolean;  // Fall back to old disk-based sync
}

interface SyncResult {
  // Git operations
  git_pulled: boolean;
  git_pushed: boolean;
  git_error?: string;

  // Legacy disk sync (if use_legacy or no config)
  sources_found: number;
  sources_indexed: number;
  already_indexed: number;

  // Universal sync (new system)
  discovery?: {
    sources_scanned: number;
    total_files: number;
    new_files: number;
    existing_files: number;
    errors: number;
  };
  processing?: {
    processed: number;
    errors: number;
    titles: string[];
  };
}

// ============================================================================
// Legacy Disk-Based Sync (for backward compatibility)
// ============================================================================

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
    content_hash?: string;
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
    content_hash?: string;
    source_path?: string;
  },
  insights: { summary: string; themes: Theme[] }
): Promise<void> {
  const summary = insights.summary || source.content.substring(0, 500);

  const searchableText = createSearchableText({
    type: 'summary',
    text: summary,
    project: source.projects[0],
  });
  const vector = await generateEmbedding(searchableText);

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

  await addSource(dbPath, sourceRecord, vector, {
    content_hash: source.content_hash,
    source_path: source.source_path,
  });
}

async function legacyDiskSync(
  dbPath: string,
  dataDir: string
): Promise<{ sources_found: number; sources_indexed: number; already_indexed: number }> {
  const sourcesDir = path.join(dataDir, 'sources');
  const result = { sources_found: 0, sources_indexed: 0, already_indexed: 0 };

  if (!existsSync(sourcesDir)) {
    return result;
  }

  try {
    const diskSources = await readdir(sourcesDir, { withFileTypes: true });
    const diskIds = diskSources
      .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
      .map((d) => d.name);

    result.sources_found = diskIds.length;

    const indexedSources = await getAllSources(dbPath, {});
    const indexedIds = new Set(indexedSources.map((s) => s.id));
    result.already_indexed = indexedIds.size;

    const unsyncedIds = diskIds.filter((id) => !indexedIds.has(id));

    for (const sourceId of unsyncedIds) {
      const data = await loadSourceFromDisk(sourcesDir, sourceId);
      if (data) {
        await indexSource(dbPath, data.source, data.insights);
        result.sources_indexed++;
      }
    }
  } catch {
    // Sources directory doesn't exist or other error
  }

  return result;
}

// ============================================================================
// Universal Sync (new system)
// ============================================================================

async function universalSync(
  dataDir: string,
  dryRun: boolean
): Promise<{
  discovery: SyncResult['discovery'];
  processing: SyncResult['processing'];
}> {
  // Load sync configuration
  const config = await loadSyncConfig();
  const enabledSources = getEnabledSources(config);

  if (enabledSources.length === 0) {
    return {
      discovery: {
        sources_scanned: 0,
        total_files: 0,
        new_files: 0,
        existing_files: 0,
        errors: 0,
      },
      processing: undefined,
    };
  }

  // Phase 1: Discovery
  const discoveryResults = await discoverAllSources(enabledSources);
  const summary = summarizeDiscovery(discoveryResults);

  const discovery: SyncResult['discovery'] = {
    sources_scanned: summary.totalSources,
    total_files: summary.totalFiles,
    new_files: summary.newFiles,
    existing_files: summary.existingFiles,
    errors: summary.errors,
  };

  // If dry run or no new files, stop here
  if (dryRun || summary.newFiles === 0) {
    return { discovery, processing: undefined };
  }

  // Phase 2: Process new files
  const allNewFiles = discoveryResults.flatMap(r => r.newFiles);
  const processResult = await processFiles(allNewFiles, dataDir, {
    gitPush: false, // We'll handle git at the end
  });

  const processing: SyncResult['processing'] = {
    processed: processResult.processed.length,
    errors: processResult.errors.length,
    titles: processResult.processed.map(p => p.metadata.title),
  };

  return { discovery, processing };
}

// ============================================================================
// Main Handler
// ============================================================================

export async function handleSync(
  dbPath: string,
  dataDir: string,
  args: SyncArgs
): Promise<SyncResult> {
  const doPull = args.git_pull !== false;
  const doPush = args.git_push !== false;
  const indexNew = args.index_new !== false;
  const dryRun = args.dry_run === true;
  const useLegacy = args.use_legacy === true;

  resetDatabaseConnection();

  const result: SyncResult = {
    git_pulled: false,
    git_pushed: false,
    sources_found: 0,
    sources_indexed: 0,
    already_indexed: 0,
  };

  // 1. Git pull
  if (doPull) {
    const pullResult = await gitPull(dataDir);
    result.git_pulled = pullResult.success && (pullResult.message?.includes('Pulled') || false);
    if (pullResult.error) {
      result.git_error = pullResult.error;
    }
  }

  // 2. Sync sources
  if (indexNew) {
    // Check if we have sync config
    const config = await loadSyncConfig();
    const hasUniversalSources = getEnabledSources(config).length > 0;

    if (hasUniversalSources && !useLegacy) {
      // Use new universal sync
      const { discovery, processing } = await universalSync(dataDir, dryRun);
      result.discovery = discovery;
      result.processing = processing;
    }

    // Always run legacy disk sync for backward compatibility
    // (picks up sources added via old `lore ingest` command)
    const legacyResult = await legacyDiskSync(dbPath, dataDir);
    result.sources_found = legacyResult.sources_found;
    result.sources_indexed = legacyResult.sources_indexed;
    result.already_indexed = legacyResult.already_indexed;
  }

  // 3. Git push
  if (doPush && !dryRun) {
    const totalNew = (result.processing?.processed || 0) + result.sources_indexed;
    if (totalNew > 0) {
      const pushResult = await gitCommitAndPush(
        dataDir,
        `Sync: Added ${totalNew} source(s)`
      );
      result.git_pushed = pushResult.success && (pushResult.message?.includes('pushed') || false);
    }
  }

  return result;
}
