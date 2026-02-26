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

import { readdir, readFile, mkdir, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

import {
  getAllSourceIds,
  addSource,
  getSourceContentMap,
  getSourcesWithPaths,
  getSourceIdsWithoutContent,
  backfillSourceContent,
  getSupabase,
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
    edited_files: number;
    existing_files: number;
    errors: number;
  };
  processing?: {
    processed: number;
    errors: number;
    titles: string[];
  };

  // Local content reconciliation
  reconciled: number;
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
    content: source.content,
    content_size: Buffer.byteLength(source.content, 'utf-8'),
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

  // UUID v4 pattern — only index directories with valid UUID names.
  // Non-UUID directories (e.g. slugs from external systems) cause Supabase errors.
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  try {
    const diskSources = await readdir(sourcesDir, { withFileTypes: true });
    const diskIds = diskSources
      .filter((d) => d.isDirectory() && !d.name.startsWith('.') && uuidPattern.test(d.name))
      .filter((d) => existsSync(path.join(sourcesDir, d.name, 'metadata.json')))
      .map((d) => d.name);

    result.sources_found = diskIds.length;

    const indexedIds = await getAllSourceIds(dbPath);
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
// Local Content Reconciliation
// ============================================================================

/**
 * Ensures every source in Supabase with a source_path has a local
 * ~/.lore/sources/{id}/content.md file. This handles:
 * - Sources indexed before storeSourceToDisk was implemented
 * - Sources from other machines (in shared Supabase but no local content)
 * - Any edge case where Supabase write succeeded but disk write failed
 *
 * Cost: One Supabase query + local filesystem checks. No LLM calls.
 */
async function reconcileLocalContent(dataDir: string, dbPath: string): Promise<number> {
  const sourcesDir = path.join(dataDir, 'sources');
  const textExts = ['.md', '.txt', '.json', '.jsonl', '.csv', '.xml', '.yaml', '.yml', '.html', '.log'];

  // Get all source IDs (paginated, no 1000-row cap) + source_path map
  const allSourceIds = await getAllSourceIds(dbPath);
  if (allSourceIds.size === 0) return 0;

  const sourcesWithPaths = await getSourcesWithPaths(dbPath);
  const pathMap = new Map(sourcesWithPaths.map(s => [s.id, s.source_path]));

  // Phase 1: Determine which sources are missing local content.md
  const missingIds: string[] = [];
  let reconciled = 0;
  for (const sourceId of allSourceIds) {
    const contentPath = path.join(sourcesDir, sourceId, 'content.md');
    if (existsSync(contentPath)) {
      try {
        const existing = await readFile(contentPath, 'utf-8');
        if (existing.trim().length > 0 && !existing.startsWith('<!-- lore:stub -->')) continue;
        // Empty or stub — try to replace with real content below
      } catch {
        // Unreadable file — try to replace
      }
    }

    // Try original source_path first (no cloud fetch needed)
    const sourcePath = pathMap.get(sourceId);
    if (sourcePath && existsSync(sourcePath)) {
      const ext = path.extname(sourcePath).toLowerCase();
      if (textExts.includes(ext)) {
        try {
          const content = await readFile(sourcePath, 'utf-8');
          if (content) {
            await mkdir(path.join(sourcesDir, sourceId), { recursive: true });
            await writeFile(contentPath, content);
            reconciled++;
            continue; // Reconciled from disk — no cloud needed
          }
        } catch {
          // Fall through to cloud fetch
        }
      }
    }

    missingIds.push(sourceId);
  }

  // Phase 2: Fetch cloud content only for sources still missing
  if (missingIds.length > 0) {
    const cloudContentMap = await getSourceContentMap(dbPath, missingIds);

    for (const sourceId of missingIds) {
      const content = cloudContentMap.get(sourceId);
      if (!content) continue;

      const sourceDir = path.join(sourcesDir, sourceId);
      const contentPath = path.join(sourceDir, 'content.md');

      try {
        await mkdir(sourceDir, { recursive: true });
        await writeFile(contentPath, content);
        reconciled++;
      } catch {
        // Skip on write failure — will retry on next sync
      }
    }
  }

  // Phase 3: Backfill cloud content for pre-feature sources
  // Sources with local content.md but no cloud content get pushed to Lore Cloud
  try {
    const idsWithoutCloud = await getSourceIdsWithoutContent(dbPath);
    if (idsWithoutCloud.size > 0) {
      const backfillUpdates: Array<{ id: string; content: string }> = [];
      for (const sourceId of idsWithoutCloud) {
        const contentPath = path.join(sourcesDir, sourceId, 'content.md');
        if (!existsSync(contentPath)) continue;
        try {
          const content = await readFile(contentPath, 'utf-8');
          if (content && !content.startsWith('<!-- lore:stub -->')) {
            backfillUpdates.push({ id: sourceId, content });
          }
        } catch {
          // Skip unreadable files
        }
      }
      if (backfillUpdates.length > 0) {
        await backfillSourceContent(dbPath, backfillUpdates);
      }
    }
  } catch {
    // Backfill is best-effort — don't fail reconciliation
  }

  return reconciled;
}

// ============================================================================
// Universal Sync (new system)
// ============================================================================

async function universalSync(
  dataDir: string,
  dryRun: boolean,
  hookContext?: { mode: 'mcp' | 'cli' }
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
        edited_files: 0,
        existing_files: 0,
        errors: 0,
      },
      processing: undefined,
    };
  }

  // Phase 1: Discovery (blocklist filters out previously deleted files)
  const discoveryResults = await discoverAllSources(enabledSources, { dataDir });
  const summary = summarizeDiscovery(discoveryResults);

  const discovery: SyncResult['discovery'] = {
    sources_scanned: summary.totalSources,
    total_files: summary.totalFiles,
    new_files: summary.newFiles,
    edited_files: summary.editedFiles,
    existing_files: summary.existingFiles,
    errors: summary.errors,
  };

  // If dry run or no new/edited files, stop here
  const totalToProcess = summary.newFiles + summary.editedFiles;
  if (dryRun || totalToProcess === 0) {
    return { discovery, processing: undefined };
  }

  // Pre-flight auth check: reset the DB connection and verify auth works
  // BEFORE spending money on LLM calls. Discovery may have used a token
  // that could expire during the (much longer) processing phase.
  resetDatabaseConnection();
  try {
    const client = await getSupabase();
    const { error } = await client.from('sources').select('id').limit(1);
    if (error) {
      throw new Error(`Supabase pre-flight check failed: ${error.message} (code: ${error.code})`);
    }
  } catch (preflight) {
    console.error(`[sync] Auth pre-flight check failed before processing ${totalToProcess} files: ${preflight}`);
    throw new Error(`Auth check failed before processing. Run 'lore auth login' to re-authenticate. (${totalToProcess} files skipped to prevent wasted API spend)`);
  }

  // Phase 2: Process new and edited files
  const allNewFiles = discoveryResults.flatMap(r => r.newFiles);
  const allEditedFiles = discoveryResults.flatMap(r => r.editedFiles);
  const allFilesToProcess = [...allNewFiles, ...allEditedFiles];

  const processResult = await processFiles(allFilesToProcess, dataDir, {
    gitPush: false, // We'll handle git at the end
    hookContext,
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
  args: SyncArgs,
  options: { hookContext?: { mode: 'mcp' | 'cli' }; onProgress?: (progress: number, total?: number, message?: string) => Promise<void> } = {}
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
    reconciled: 0,
  };

  const { onProgress } = options;

  // 1. Git pull
  if (doPull) {
    await onProgress?.(5, undefined, 'Pulling from git...');
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
      await onProgress?.(20, undefined, 'Discovering new files...');
      const { discovery, processing } = await universalSync(
        dataDir,
        dryRun,
        options.hookContext
      );
      result.discovery = discovery;
      result.processing = processing;
    }

    // Always run legacy disk sync for backward compatibility
    // (picks up sources added via old `lore ingest` command)
    await onProgress?.(60, undefined, 'Running legacy sync...');
    const legacyResult = await legacyDiskSync(dbPath, dataDir);
    result.sources_found = legacyResult.sources_found;
    result.sources_indexed = legacyResult.sources_indexed;
    result.already_indexed = legacyResult.already_indexed;

    // Reconcile: ensure every Supabase source has local content.md
    await onProgress?.(80, undefined, 'Reconciling local content...');
    result.reconciled = await reconcileLocalContent(dataDir, dbPath);
  }

  // 3. Git commit + push (also flushes any previously unpushed commits)
  if (doPush && !dryRun) {
    const totalNew = (result.processing?.processed || 0) + result.sources_indexed + result.reconciled;
    const pushResult = await gitCommitAndPush(
      dataDir,
      totalNew > 0 ? `Sync: Added ${totalNew} source(s)` : 'Sync'
    );
    result.git_pushed = pushResult.success && (pushResult.message?.includes('pushed') || false);
    if (pushResult.error) {
      result.git_error = (result.git_error ? result.git_error + '; ' : '') + pushResult.error;
    }
  }

  return result;
}
