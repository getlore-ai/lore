#!/usr/bin/env node

/**
 * Lore CLI
 *
 * Commands:
 * - ingest: Import sources from various formats (Granola, Claude, etc.)
 * - sync: Rebuild the vector index
 * - search: Search the knowledge base from command line
 * - mcp: Start the MCP server
 */

// Load environment variables from .env files
// .env.local takes precedence over .env
import { config } from 'dotenv';
import { existsSync as envExists, readFileSync } from 'fs';
import { parse } from 'dotenv';

// Load .env files silently (without the v17 logging)
function loadEnvFile(filePath: string, override = false): void {
  if (!envExists(filePath)) return;
  try {
    const content = readFileSync(filePath, 'utf-8');
    const parsed = parse(content);
    for (const [key, value] of Object.entries(parsed)) {
      if (override || process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  } catch {
    // Silently ignore errors
  }
}

// Load .env first, then .env.local (overrides)
loadEnvFile('.env');
loadEnvFile('.env.local', true);

import { Command } from 'commander';
import path from 'path';
import { mkdir, writeFile, readFile } from 'fs/promises';
import { existsSync } from 'fs';  // Re-import for use in CLI commands

import { ingestGranolaExports, listGranolaExports } from './ingest/granola.js';
import { ingestClaudeCodeConversations, listClaudeCodeConversations } from './ingest/claude-code.js';
import { ingestMarkdownDirectory, listMarkdownFiles } from './ingest/markdown.js';
import {
  initializeTables,
  storeSources,
  searchSources,
  getAllSources,
  indexExists,
} from './core/vector-store.js';
import { generateEmbedding, generateEmbeddings, createSearchableText } from './core/embedder.js';
import type { SourceDocument, SourceRecord, Quote, Theme } from './core/types.js';

const program = new Command();

// Default data directory
const DEFAULT_DATA_DIR = process.env.LORE_DATA_DIR || './data';

program
  .name('lore')
  .description('Research knowledge repository with semantic search and citations')
  .version('0.1.0');

// ============================================================================
// Ingest Command
// ============================================================================

program
  .command('ingest')
  .description('Import sources into the knowledge repository')
  .argument('<path>', 'Path to source file or directory')
  .option('-t, --type <type>', 'Source type (granola, claude-code, markdown)', 'granola')
  .option('-p, --project <project>', 'Associate with project')
  .option('--tags <tags>', 'Comma-separated tags')
  .option('-d, --data-dir <dir>', 'Data directory', DEFAULT_DATA_DIR)
  .option('--skip-extraction', 'Skip insight extraction (faster)')
  .option('--skip-indexing', 'Skip vector indexing (run sync later)')
  .action(async (sourcePath, options) => {
    const dataDir = options.dataDir;
    const dbPath = path.join(dataDir, 'lore.lance');
    const sourcesDir = path.join(dataDir, 'sources');

    console.log(`\nLore Ingest`);
    console.log(`===========`);
    console.log(`Source: ${sourcePath}`);
    console.log(`Type: ${options.type}`);
    console.log(`Project: ${options.project || '(none)'}`);
    console.log(`Data dir: ${dataDir}\n`);

    // Ensure directories exist
    await mkdir(sourcesDir, { recursive: true });

    if (options.type === 'granola') {
      // List what we'll ingest
      const exports = await listGranolaExports(sourcePath);
      console.log(`Found ${exports.length} Granola exports\n`);

      if (exports.length === 0) {
        console.log('No exports found. Make sure the path points to a granola-extractor export directory.');
        process.exit(1);
      }

      // Check for existing sources
      const existingIds: string[] = [];
      if (await indexExists(dbPath)) {
        const existing = await getAllSources(dbPath, {});
        existingIds.push(...existing.map((s) => s.id));
      }

      const newExports = exports.filter((e) => !existingIds.includes(e.id));
      console.log(`New sources to ingest: ${newExports.length}`);
      console.log(`Already indexed: ${existingIds.length}\n`);

      if (newExports.length === 0) {
        console.log('All sources already ingested. Run with --force to re-ingest.');
        return;
      }

      // Ingest with progress
      console.log('Ingesting sources...');
      const results = await ingestGranolaExports(sourcePath, {
        project: options.project,
        extractInsightsEnabled: !options.skipExtraction,
        skipExisting: existingIds,
        onProgress: (current, total, title) => {
          process.stdout.write(`\r  [${current}/${total}] ${title.substring(0, 50).padEnd(50)}`);
        },
      });
      console.log('\n');

      // Save sources to disk
      console.log('Saving sources to disk...');
      for (const result of results) {
        const sourceDir = path.join(sourcesDir, result.source.id);
        await mkdir(sourceDir, { recursive: true });

        // Save content
        await writeFile(path.join(sourceDir, 'content.md'), result.source.content);

        // Save metadata
        const metadata = {
          id: result.source.id,
          title: result.source.title,
          source_type: result.source.source_type,
          content_type: result.source.content_type,
          created_at: result.source.created_at,
          imported_at: result.source.imported_at,
          projects: result.source.projects,
          tags: result.source.tags,
          source_path: result.source.source_path,
        };
        await writeFile(path.join(sourceDir, 'metadata.json'), JSON.stringify(metadata, null, 2));

        // Save insights if extracted
        if (result.insights) {
          await writeFile(path.join(sourceDir, 'insights.json'), JSON.stringify(result.insights, null, 2));
        }
      }
      console.log(`Saved ${results.length} sources to ${sourcesDir}\n`);

      // Index if not skipped
      if (!options.skipIndexing) {
        console.log('Building vector index...');
        await buildIndex(dataDir, results);
        console.log('Done!\n');
      } else {
        console.log('Skipped indexing. Run "lore sync" to build the vector index.\n');
      }

      console.log(`\nIngested ${results.length} sources.`);
      console.log(`Run "lore search <query>" to search, or start the MCP server with "lore mcp".`);
    } else if (options.type === 'claude-code') {
      // List what we'll ingest
      const conversations = await listClaudeCodeConversations(sourcePath);
      console.log(`Found ${conversations.length} Claude Code conversations\n`);

      if (conversations.length === 0) {
        console.log('No conversations found. Make sure the path points to ~/.claude/projects or similar.');
        process.exit(1);
      }

      // Check for existing sources
      const existingIds: string[] = [];
      if (await indexExists(dbPath)) {
        const existing = await getAllSources(dbPath, {});
        existingIds.push(...existing.map((s) => s.id));
      }

      const newConversations = conversations.filter((c) => !existingIds.includes(c.id));
      console.log(`New conversations to ingest: ${newConversations.length}`);
      console.log(`Already indexed: ${existingIds.length}\n`);

      if (newConversations.length === 0) {
        console.log('All conversations already ingested.');
        return;
      }

      // Ingest with progress
      console.log('Ingesting conversations...');
      const results = await ingestClaudeCodeConversations(sourcePath, {
        project: options.project,
        extractInsightsEnabled: !options.skipExtraction,
        skipExisting: existingIds,
        onProgress: (current, total, title) => {
          process.stdout.write(`\r  [${current}/${total}] ${title.substring(0, 50).padEnd(50)}`);
        },
      });
      console.log('\n');

      // Save sources to disk
      console.log('Saving sources to disk...');
      for (const result of results) {
        const sourceDir = path.join(sourcesDir, result.source.id);
        await mkdir(sourceDir, { recursive: true });

        // Save content
        await writeFile(path.join(sourceDir, 'content.md'), result.source.content);

        // Save metadata
        const metadata = {
          id: result.source.id,
          title: result.source.title,
          source_type: result.source.source_type,
          content_type: result.source.content_type,
          created_at: result.source.created_at,
          imported_at: result.source.imported_at,
          projects: result.source.projects,
          tags: result.source.tags,
          source_path: result.source.source_path,
        };
        await writeFile(path.join(sourceDir, 'metadata.json'), JSON.stringify(metadata, null, 2));

        // Save insights if extracted
        if (result.insights) {
          await writeFile(path.join(sourceDir, 'insights.json'), JSON.stringify(result.insights, null, 2));
        }
      }
      console.log(`Saved ${results.length} sources to ${sourcesDir}\n`);

      // Index if not skipped
      if (!options.skipIndexing) {
        console.log('Building vector index...');
        await buildIndex(dataDir, results.map((r) => ({
          source: r.source,
          notes: '',
          transcript: '',
          insights: r.insights,
        })));
        console.log('Done!\n');
      } else {
        console.log('Skipped indexing. Run "lore sync" to build the vector index.\n');
      }

      console.log(`\nIngested ${results.length} conversations.`);
      console.log(`Run "lore search <query>" to search, or start the MCP server with "lore mcp".`);
    } else if (options.type === 'markdown') {
      // List what we'll ingest
      const files = await listMarkdownFiles(sourcePath);
      console.log(`Found ${files.length} markdown files\n`);

      if (files.length === 0) {
        console.log('No markdown files found in the specified directory.');
        process.exit(1);
      }

      // Check for existing sources
      const existingIds: string[] = [];
      if (await indexExists(dbPath)) {
        const existing = await getAllSources(dbPath, {});
        existingIds.push(...existing.map((s) => s.id));
      }

      console.log(`Already indexed: ${existingIds.length}\n`);

      // Ingest with progress
      console.log('Ingesting markdown files...');
      const results = await ingestMarkdownDirectory(sourcePath, {
        project: options.project,
        tags: options.tags?.split(',').map((t: string) => t.trim()),
        extractInsightsEnabled: !options.skipExtraction,
        skipExisting: existingIds,
        onProgress: (current, total, title) => {
          process.stdout.write(`\r  [${current}/${total}] ${title.substring(0, 50).padEnd(50)}`);
        },
      });
      console.log('\n');

      // Save sources to disk
      console.log('Saving sources to disk...');
      for (const result of results) {
        const sourceDir = path.join(sourcesDir, result.source.id);
        await mkdir(sourceDir, { recursive: true });

        // Save content
        await writeFile(path.join(sourceDir, 'content.md'), result.source.content);

        // Save metadata
        const metadata = {
          id: result.source.id,
          title: result.source.title,
          source_type: result.source.source_type,
          content_type: result.source.content_type,
          created_at: result.source.created_at,
          imported_at: result.source.imported_at,
          projects: result.source.projects,
          tags: result.source.tags,
          source_path: result.source.source_path,
        };
        await writeFile(path.join(sourceDir, 'metadata.json'), JSON.stringify(metadata, null, 2));

        // Save insights if extracted
        if (result.insights) {
          await writeFile(path.join(sourceDir, 'insights.json'), JSON.stringify(result.insights, null, 2));
        }
      }
      console.log(`Saved ${results.length} sources to ${sourcesDir}\n`);

      // Index if not skipped
      if (!options.skipIndexing) {
        console.log('Building vector index...');
        await buildIndex(dataDir, results.map((r) => ({
          source: r.source,
          notes: '',
          transcript: '',
          insights: r.insights,
        })));
        console.log('Done!\n');
      } else {
        console.log('Skipped indexing. Run "lore sync" to build the vector index.\n');
      }

      console.log(`\nIngested ${results.length} markdown files.`);
      console.log(`Run "lore search <query>" to search, or start the MCP server with "lore mcp".`);
    } else {
      console.log(`Source type "${options.type}" not yet implemented.`);
      console.log('Supported types: granola, claude-code, markdown');
      process.exit(1);
    }
  });

// ============================================================================
// Sync Command (Universal Sync)
// ============================================================================

program
  .command('sync')
  .description('Sync sources from configured directories')
  .option('-d, --data-dir <dir>', 'Data directory', DEFAULT_DATA_DIR)
  .option('--dry-run', 'Show what would be synced without processing')
  .option('--legacy', 'Use legacy disk-based sync only')
  .option('--no-git', 'Skip git operations')
  .action(async (options) => {
    const { handleSync } = await import('./mcp/handlers/sync.js');

    const dataDir = options.dataDir;
    const dbPath = path.join(dataDir, 'lore.lance');

    console.log(`\nLore Sync`);
    console.log(`=========`);
    console.log(`Data dir: ${dataDir}`);
    if (options.dryRun) console.log(`Mode: DRY RUN`);
    console.log('');

    const result = await handleSync(dbPath, dataDir, {
      git_pull: options.git !== false,
      git_push: options.git !== false,
      dry_run: options.dryRun,
      use_legacy: options.legacy,
    });

    // Show results
    if (result.git_pulled) {
      console.log('✓ Pulled latest changes from git');
    }
    if (result.git_error) {
      console.log(`⚠ Git: ${result.git_error}`);
    }

    // Universal sync results
    if (result.discovery) {
      console.log(`\nUniversal Sync:`);
      console.log(`  Sources scanned: ${result.discovery.sources_scanned}`);
      console.log(`  Files found: ${result.discovery.total_files}`);
      console.log(`  New files: ${result.discovery.new_files}`);
      console.log(`  Already indexed: ${result.discovery.existing_files}`);
      if (result.discovery.errors > 0) {
        console.log(`  Errors: ${result.discovery.errors}`);
      }
    }

    if (result.processing) {
      console.log(`\nProcessed ${result.processing.processed} new files:`);
      for (const title of result.processing.titles.slice(0, 10)) {
        console.log(`  • ${title}`);
      }
      if (result.processing.titles.length > 10) {
        console.log(`  ... and ${result.processing.titles.length - 10} more`);
      }
      if (result.processing.errors > 0) {
        console.log(`  Errors: ${result.processing.errors}`);
      }
    }

    // Legacy sync results
    if (result.sources_found > 0 || result.sources_indexed > 0) {
      console.log(`\nLegacy Sync:`);
      console.log(`  Sources on disk: ${result.sources_found}`);
      console.log(`  Newly indexed: ${result.sources_indexed}`);
      console.log(`  Already indexed: ${result.already_indexed}`);
    }

    if (result.git_pushed) {
      console.log('\n✓ Pushed changes to git');
    }

    console.log('\nSync complete!');
  });

// ============================================================================
// Watch Command (Continuous file watching)
// ============================================================================

// ANSI color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
  bgRed: '\x1b[41m',
};

const c = {
  title: (s: string) => `${colors.bold}${colors.cyan}${s}${colors.reset}`,
  success: (s: string) => `${colors.green}${s}${colors.reset}`,
  warning: (s: string) => `${colors.yellow}${s}${colors.reset}`,
  error: (s: string) => `${colors.bgRed}${colors.white} ${s} ${colors.reset}`,
  info: (s: string) => `${colors.blue}${s}${colors.reset}`,
  dim: (s: string) => `${colors.dim}${s}${colors.reset}`,
  file: (s: string) => `${colors.magenta}${s}${colors.reset}`,
  path: (s: string) => `${colors.gray}${s}${colors.reset}`,
  time: (s: string) => `${colors.dim}${s}${colors.reset}`,
  badge: (s: string, bg: string) => `${bg}${colors.white}${colors.bold} ${s} ${colors.reset}`,
};

program
  .command('watch')
  .description('Watch configured directories and sync automatically when files change')
  .option('-d, --data-dir <dir>', 'Data directory', DEFAULT_DATA_DIR)
  .option('--interval <ms>', 'Debounce interval in ms', '2000')
  .option('--no-initial', 'Skip initial sync on startup')
  .action(async (options) => {
    const chokidar = await import('chokidar');
    const { loadSyncConfig, getEnabledSources, expandPath } = await import('./sync/config.js');
    const { handleSync } = await import('./mcp/handlers/sync.js');

    const dataDir = options.dataDir;
    const dbPath = path.join(dataDir, 'lore.lance');
    const debounceMs = parseInt(options.interval, 10);

    // Header
    console.log('');
    console.log(c.title('  ╔══════════════════════════════════════╗'));
    console.log(c.title('  ║           🔍 LORE WATCH              ║'));
    console.log(c.title('  ╚══════════════════════════════════════╝'));
    console.log('');
    console.log(`  ${c.dim('Data:')}     ${dataDir}`);
    console.log(`  ${c.dim('Debounce:')} ${debounceMs}ms`);
    console.log('');

    // Load sync sources
    const config = await loadSyncConfig();
    const sources = getEnabledSources(config);

    // Show watched directories (or note if none)
    const watchPaths: string[] = [];
    if (sources.length === 0) {
      console.log(c.warning('  ⚠ No local sync sources configured'));
      console.log(c.dim('    Will still pull from remote and process new files'));
      console.log(c.dim('    Run "lore sources add" to watch local directories'));
      console.log('');
    } else {
      console.log(c.info('  📁 Watching:'));
      for (const source of sources) {
        const expanded = expandPath(source.path);
        console.log(`     ${c.file(source.name)}`);
        console.log(`     ${c.path(expanded)}`);
        console.log(`     ${c.dim(`glob: ${source.glob} → project: ${source.project}`)}`);
        console.log('');
        watchPaths.push(expanded);
      }
    }

    // Run initial sync
    if (options.initial !== false) {
      console.log(c.info('  ⚡ Initial sync...'));
      try {
        const result = await handleSync(dbPath, dataDir, {
          git_pull: true,
          git_push: true,
        });

        const totalFiles = result.discovery?.total_files || 0;
        const newFiles = result.discovery?.new_files || 0;
        const processed = result.processing?.processed || 0;

        if (processed > 0) {
          console.log(`     ${c.success('✓')} Processed ${c.file(String(processed))} new file(s)`);
          for (const title of result.processing?.titles || []) {
            console.log(`       ${c.dim('•')} ${title}`);
          }
        } else {
          console.log(`     ${c.success('✓')} ${totalFiles} files indexed, ${newFiles} new`);
        }
      } catch (error) {
        console.log(`     ${c.error('✗')} Initial sync failed: ${error}`);
      }
      console.log('');
    }

    // Divider
    console.log(c.dim('  ─────────────────────────────────────────'));
    console.log(`  ${c.success('●')} Watching for changes... ${c.dim('(Ctrl+C to stop)')}`);
    console.log(c.dim('  ─────────────────────────────────────────'));
    console.log('');

    // Track pending changes for debouncing
    let pendingChanges = new Map<string, { type: 'add' | 'change'; path: string }>();
    let syncTimeout: ReturnType<typeof setTimeout> | null = null;
    let isSyncing = false;

    function getTimestamp() {
      return new Date().toLocaleTimeString('en-US', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
    }

    async function runSync() {
      if (isSyncing) return;
      isSyncing = true;

      const changes = Array.from(pendingChanges.values());
      pendingChanges.clear();

      const ts = getTimestamp();
      console.log(`  ${c.time(ts)} ${c.badge('SYNC', colors.bgBlue)} Processing ${changes.length} file(s)...`);

      // Show files being processed
      for (const change of changes) {
        const icon = change.type === 'add' ? '+' : '~';
        const relativePath = change.path.replace(process.env.HOME || '', '~');
        console.log(`             ${c.dim(icon)} ${c.file(path.basename(change.path))}`);
        console.log(`               ${c.path(relativePath)}`);
      }

      try {
        const result = await handleSync(dbPath, dataDir, {
          git_pull: false,
          git_push: true,
        });

        const processed = result.processing?.processed || 0;
        const errors = result.processing?.errors || 0;

        if (processed > 0) {
          console.log(`  ${c.time(ts)} ${c.badge('DONE', colors.bgGreen)} Indexed ${processed} file(s):`);
          for (const title of result.processing?.titles || []) {
            console.log(`             ${c.success('✓')} ${title}`);
          }
        } else if (result.discovery && result.discovery.new_files === 0) {
          console.log(`  ${c.time(ts)} ${c.badge('SKIP', colors.bgYellow)} Already indexed`);
        }

        if (errors > 0) {
          console.log(`  ${c.time(ts)} ${c.error(`${errors} ERROR(S)`)}`);
        }
      } catch (error) {
        console.log(`  ${c.time(ts)} ${c.error('SYNC FAILED')} ${error}`);
      }

      isSyncing = false;
      console.log('');
    }

    function scheduleSync(filePath: string, type: 'add' | 'change') {
      pendingChanges.set(filePath, { type, path: filePath });

      if (syncTimeout) {
        clearTimeout(syncTimeout);
      }

      syncTimeout = setTimeout(runSync, debounceMs);
    }

    // Set up file watcher
    // Set up file watcher (only if there are local sources to watch)
    let watcher: ReturnType<typeof chokidar.watch> | null = null;
    if (watchPaths.length > 0) {
      watcher = chokidar.watch(watchPaths, {
        ignored: [
          /(^|[\/\\])\../,  // Ignore dotfiles
          /node_modules/,
          /__pycache__/,
        ],
        persistent: true,
        ignoreInitial: true,
        awaitWriteFinish: {
          stabilityThreshold: 500,
          pollInterval: 100,
        },
      });

      watcher
        .on('add', (filePath) => {
          const ts = getTimestamp();
          console.log(`  ${c.time(ts)} ${c.success('+')} ${c.file(path.basename(filePath))} ${c.dim('added')}`);
          scheduleSync(filePath, 'add');
        })
        .on('change', (filePath) => {
          const ts = getTimestamp();
          console.log(`  ${c.time(ts)} ${c.warning('~')} ${c.file(path.basename(filePath))} ${c.dim('modified')}`);
          scheduleSync(filePath, 'change');
        })
        .on('error', (error) => {
          console.log(`  ${c.error('WATCHER ERROR')} ${error}`);
        });
    }

    // Periodic sync (pull from remote + check for new files)
    const PULL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

    async function periodicSync() {
      if (isSyncing) return;

      const ts = getTimestamp();
      console.log(`  ${c.time(ts)} ${c.badge('PULL', colors.bgBlue)} Checking for remote changes...`);

      try {
        const result = await handleSync(dbPath, dataDir, {
          git_pull: true,
          git_push: false,  // Don't push on periodic check
        });

        if (result.git_pulled) {
          console.log(`  ${c.time(ts)} ${c.success('✓')} Pulled latest changes`);
        }

        const newFiles = result.discovery?.new_files || 0;
        if (newFiles > 0) {
          console.log(`  ${c.time(ts)} ${c.info('→')} Found ${newFiles} new file(s) from remote`);
          // Process them
          const processResult = await handleSync(dbPath, dataDir, {
            git_pull: false,
            git_push: true,
          });
          if (processResult.processing && processResult.processing.processed > 0) {
            console.log(`  ${c.time(ts)} ${c.badge('DONE', colors.bgGreen)} Indexed ${processResult.processing.processed} file(s):`);
            for (const title of processResult.processing.titles) {
              console.log(`             ${c.success('✓')} ${title}`);
            }
          }
        } else {
          console.log(`  ${c.time(ts)} ${c.dim('✓ Up to date')}`);
        }
      } catch (error) {
        console.log(`  ${c.time(ts)} ${c.warning('⚠')} Pull failed: ${error}`);
      }
      console.log('');
    }

    // Run first sync immediately, then every PULL_INTERVAL_MS
    console.log(`  ${c.dim(`Remote sync every ${PULL_INTERVAL_MS / 60000} minutes`)}`);
    console.log('');

    // Immediate first sync
    await periodicSync();

    // Then periodic
    const pullInterval = setInterval(periodicSync, PULL_INTERVAL_MS);

    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      console.log('\n\nShutting down...');
      clearInterval(pullInterval);
      if (watcher) {
        await watcher.close();
      }
      console.log('Goodbye!');
      process.exit(0);
    });
  });

// ============================================================================
// Sources Command (Manage sync sources)
// ============================================================================

const sourcesCmd = program
  .command('sources')
  .description('Manage sync source directories');

sourcesCmd
  .command('list')
  .description('List configured sync sources')
  .action(async () => {
    const { loadSyncConfig, getConfigPath } = await import('./sync/config.js');

    console.log(`\nSync Sources`);
    console.log(`============`);
    console.log(`Config: ${getConfigPath()}\n`);

    const config = await loadSyncConfig();

    if (config.sources.length === 0) {
      console.log('No sources configured. Run "lore sources add" to add one.');
      return;
    }

    for (const source of config.sources) {
      const status = source.enabled ? '✓' : '○';
      console.log(`${status} ${source.name}`);
      console.log(`    Path: ${source.path}`);
      console.log(`    Glob: ${source.glob}`);
      console.log(`    Project: ${source.project}`);
      console.log('');
    }
  });

sourcesCmd
  .command('add')
  .description('Add a new sync source')
  .option('-n, --name <name>', 'Source name')
  .option('-p, --path <path>', 'Directory path')
  .option('-g, --glob <glob>', 'File glob pattern', '**/*.md')
  .option('--project <project>', 'Default project')
  .action(async (options) => {
    const { addSyncSource } = await import('./sync/config.js');
    const readline = await import('readline');

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const ask = (question: string, defaultValue?: string): Promise<string> =>
      new Promise((resolve) => {
        const prompt = defaultValue ? `${question} [${defaultValue}]: ` : `${question}: `;
        rl.question(prompt, (answer) => {
          resolve(answer.trim() || defaultValue || '');
        });
      });

    console.log(`\nAdd Sync Source`);
    console.log(`===============\n`);

    const name = options.name || await ask('Name (e.g., "Granola Meetings")');
    const sourcePath = options.path || await ask('Path (e.g., ~/granola-extractor/output)');
    const glob = options.glob || await ask('Glob pattern', '**/*.md');
    const project = options.project || await ask('Default project');

    rl.close();

    if (!name || !sourcePath || !project) {
      console.log('\nAll fields are required.');
      process.exit(1);
    }

    try {
      await addSyncSource({
        name,
        path: sourcePath,
        glob,
        project,
        enabled: true,
      });

      console.log(`\n✓ Added source "${name}"`);
      console.log(`\nRun "lore sync" to process files from this source.`);
    } catch (error) {
      console.error(`\nError: ${error}`);
      process.exit(1);
    }
  });

sourcesCmd
  .command('enable <name>')
  .description('Enable a sync source')
  .action(async (name) => {
    const { updateSyncSource } = await import('./sync/config.js');

    try {
      await updateSyncSource(name, { enabled: true });
      console.log(`✓ Enabled "${name}"`);
    } catch (error) {
      console.error(`Error: ${error}`);
      process.exit(1);
    }
  });

sourcesCmd
  .command('disable <name>')
  .description('Disable a sync source')
  .action(async (name) => {
    const { updateSyncSource } = await import('./sync/config.js');

    try {
      await updateSyncSource(name, { enabled: false });
      console.log(`✓ Disabled "${name}"`);
    } catch (error) {
      console.error(`Error: ${error}`);
      process.exit(1);
    }
  });

sourcesCmd
  .command('remove <name>')
  .description('Remove a sync source')
  .action(async (name) => {
    const { removeSyncSource } = await import('./sync/config.js');

    try {
      await removeSyncSource(name);
      console.log(`✓ Removed "${name}"`);
    } catch (error) {
      console.error(`Error: ${error}`);
      process.exit(1);
    }
  });

// ============================================================================
// Search Command
// ============================================================================

program
  .command('search')
  .description('Search the knowledge repository')
  .argument('<query>', 'Search query')
  .option('-p, --project <project>', 'Filter by project')
  .option('-l, --limit <limit>', 'Max results', '5')
  .option('-d, --data-dir <dir>', 'Data directory', DEFAULT_DATA_DIR)
  .action(async (query, options) => {
    const dataDir = options.dataDir;
    const dbPath = path.join(dataDir, 'lore.lance');

    if (!(await indexExists(dbPath))) {
      console.log('No index found. Run "lore ingest" first.');
      process.exit(1);
    }

    console.log(`\nSearching for: "${query}"\n`);

    const queryVector = await generateEmbedding(query);
    const results = await searchSources(dbPath, queryVector, {
      limit: parseInt(options.limit),
      project: options.project,
    });

    if (results.length === 0) {
      console.log('No results found.');
      return;
    }

    for (const result of results) {
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      console.log(`📄 ${result.title}`);
      console.log(`   Type: ${result.source_type} | ${result.content_type}`);
      console.log(`   Projects: ${result.projects.join(', ') || '(none)'}`);
      console.log(`   Score: ${(result.score * 100).toFixed(1)}%`);
      console.log(`\n   ${result.summary}\n`);

      if (result.quotes.length > 0) {
        console.log(`   Key Quotes:`);
        for (const quote of result.quotes.slice(0, 3)) {
          const speaker = quote.speaker === 'user' ? '[You]' : '[Participant]';
          console.log(`   • ${speaker} "${quote.text.substring(0, 100)}..."`);
        }
      }
      console.log('');
    }
  });

// ============================================================================
// Projects Command
// ============================================================================

program
  .command('projects')
  .description('List all projects')
  .option('-d, --data-dir <dir>', 'Data directory', DEFAULT_DATA_DIR)
  .action(async (options) => {
    const dataDir = options.dataDir;
    const dbPath = path.join(dataDir, 'lore.lance');

    if (!(await indexExists(dbPath))) {
      console.log('No index found. Run "lore ingest" first.');
      process.exit(1);
    }

    const { getProjectStats } = await import('./core/vector-store.js');
    const projects = await getProjectStats(dbPath);

    console.log(`\nProjects (${projects.length}):`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    for (const p of projects) {
      console.log(`\n📁 ${p.project}`);
      console.log(`   Sources: ${p.source_count} | Quotes: ${p.quote_count}`);
      console.log(`   Latest: ${new Date(p.latest_activity).toLocaleDateString()}`);
    }
    console.log('');
  });

// ============================================================================
// Get Source Command
// ============================================================================

program
  .command('get')
  .description('Get full details of a specific source')
  .argument('<source_id>', 'Source ID')
  .option('-c, --content', 'Include full content')
  .option('-d, --data-dir <dir>', 'Data directory', DEFAULT_DATA_DIR)
  .action(async (sourceId, options) => {
    const { handleGetSource } = await import('./mcp/handlers/get-source.js');
    const dataDir = options.dataDir;
    const dbPath = path.join(dataDir, 'lore.lance');

    const result = await handleGetSource(dbPath, dataDir, {
      source_id: sourceId,
      include_content: options.content,
    }) as Record<string, unknown>;

    if (result.error) {
      console.error(`Error: ${result.error}`);
      process.exit(1);
    }

    console.log(`\n📄 ${result.title}`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`ID: ${result.id}`);
    console.log(`Type: ${result.source_type} | ${result.content_type}`);
    console.log(`Projects: ${(result.projects as string[])?.join(', ') || '(none)'}`);
    console.log(`Tags: ${(result.tags as string[])?.join(', ') || '(none)'}`);
    console.log(`Created: ${result.created_at}`);
    console.log(`\nSummary:\n${result.summary}`);

    const themes = result.themes as Array<{ name: string }>;
    if (themes && themes.length > 0) {
      console.log(`\nThemes:`);
      for (const theme of themes) {
        console.log(`  • ${theme.name}`);
      }
    }

    const quotes = result.quotes as Array<{ speaker: string; text: string }>;
    if (quotes && quotes.length > 0) {
      console.log(`\nQuotes (${quotes.length}):`);
      for (const quote of quotes.slice(0, 5)) {
        const speaker = quote.speaker === 'user' ? '[You]' : '[Participant]';
        console.log(`  ${speaker} "${quote.text.substring(0, 100)}${quote.text.length > 100 ? '...' : ''}"`);
      }
      if (quotes.length > 5) {
        console.log(`  ... and ${quotes.length - 5} more`);
      }
    }

    if (result.full_content) {
      console.log(`\n${'─'.repeat(60)}`);
      console.log(`Full Content:\n`);
      console.log(result.full_content);
    }
    console.log('');
  });

// ============================================================================
// List Sources Command
// ============================================================================

program
  .command('list')
  .description('List sources in the knowledge repository')
  .option('-p, --project <project>', 'Filter by project')
  .option('-t, --type <type>', 'Filter by source type')
  .option('-l, --limit <limit>', 'Max results', '20')
  .option('-d, --data-dir <dir>', 'Data directory', DEFAULT_DATA_DIR)
  .action(async (options) => {
    const { handleListSources } = await import('./mcp/handlers/list-sources.js');
    const dataDir = options.dataDir;
    const dbPath = path.join(dataDir, 'lore.lance');

    const result = await handleListSources(dbPath, {
      project: options.project,
      source_type: options.type,
      limit: parseInt(options.limit),
    }) as { sources: Array<{ id: string; title: string; source_type: string; content_type: string; projects: string[]; created_at: string; summary: string }>; total: number };

    console.log(`\nSources (${result.total}):`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    if (result.sources.length === 0) {
      console.log('No sources found.');
      return;
    }

    for (const source of result.sources) {
      const date = new Date(source.created_at).toLocaleDateString();
      console.log(`\n📄 ${source.title}`);
      console.log(`   ID: ${source.id}`);
      console.log(`   Type: ${source.source_type} | ${source.content_type}`);
      console.log(`   Projects: ${source.projects.join(', ') || '(none)'}`);
      console.log(`   Date: ${date}`);
    }
    console.log('');
  });

// ============================================================================
// Retain Command
// ============================================================================

program
  .command('retain')
  .description('Save an insight, decision, or note')
  .argument('<content>', 'Content to retain')
  .requiredOption('-p, --project <project>', 'Project this belongs to')
  .option('-t, --type <type>', 'Type: insight, decision, requirement, note', 'note')
  .option('--context <context>', 'Source context (e.g., "from interview with Sarah")')
  .option('--tags <tags>', 'Comma-separated tags')
  .option('-d, --data-dir <dir>', 'Data directory', DEFAULT_DATA_DIR)
  .option('--no-push', 'Skip git push')
  .action(async (content, options) => {
    const { handleRetain } = await import('./mcp/handlers/retain.js');
    const dataDir = options.dataDir;
    const dbPath = path.join(dataDir, 'lore.lance');

    const validTypes = ['insight', 'decision', 'requirement', 'note'];
    if (!validTypes.includes(options.type)) {
      console.error(`Invalid type: ${options.type}. Must be one of: ${validTypes.join(', ')}`);
      process.exit(1);
    }

    const result = await handleRetain(dbPath, dataDir, {
      content,
      project: options.project,
      type: options.type as 'insight' | 'decision' | 'requirement' | 'note',
      source_context: options.context,
      tags: options.tags?.split(',').map((t: string) => t.trim()),
    }, { autoPush: options.push !== false }) as { success: boolean; id: string; message: string; indexed: boolean; synced: boolean };

    if (result.success) {
      console.log(`\n✓ ${result.message}`);
      console.log(`  ID: ${result.id}`);
      console.log(`  Indexed: ${result.indexed ? 'yes' : 'no'}`);
      console.log(`  Synced: ${result.synced ? 'yes' : 'no'}`);
    } else {
      console.error(`\nFailed to retain: ${result.message}`);
      process.exit(1);
    }
  });

// ============================================================================
// Research Command
// ============================================================================

program
  .command('research')
  .description('Run comprehensive research on a topic')
  .argument('<query>', 'Research query')
  .option('-p, --project <project>', 'Focus on specific project')
  .option('-d, --data-dir <dir>', 'Data directory', DEFAULT_DATA_DIR)
  .option('--simple', 'Use simple mode (single-pass, faster)')
  .action(async (query, options) => {
    const { handleResearch } = await import('./mcp/handlers/research.js');
    const dataDir = options.dataDir;
    const dbPath = path.join(dataDir, 'lore.lance');

    if (options.simple) {
      process.env.LORE_RESEARCH_MODE = 'simple';
    }

    console.log(`\nResearching: "${query}"\n`);
    console.log('This may take a moment...\n');

    const result = await handleResearch(dbPath, dataDir, {
      task: query,
      project: options.project,
      include_sources: true,
    });

    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`📊 Research Results`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

    console.log(`Summary:\n${result.summary}\n`);

    if (result.key_findings && result.key_findings.length > 0) {
      console.log(`Key Findings:`);
      for (const finding of result.key_findings) {
        console.log(`  • ${finding}`);
      }
      console.log('');
    }

    if (result.conflicts_resolved && result.conflicts_resolved.length > 0) {
      console.log(`Conflicts Resolved:`);
      for (const conflict of result.conflicts_resolved) {
        console.log(`  ⚡ ${conflict}`);
      }
      console.log('');
    }

    if (result.supporting_quotes && result.supporting_quotes.length > 0) {
      console.log(`Supporting Quotes (${result.supporting_quotes.length}):`);
      for (const quote of result.supporting_quotes.slice(0, 5)) {
        const speaker = quote.speaker === 'user' ? '[You]' : '[Participant]';
        console.log(`  ${speaker} "${quote.text.substring(0, 80)}${quote.text.length > 80 ? '...' : ''}"`);
      }
      if (result.supporting_quotes.length > 5) {
        console.log(`  ... and ${result.supporting_quotes.length - 5} more`);
      }
      console.log('');
    }

    if (result.sources_consulted && result.sources_consulted.length > 0) {
      console.log(`Sources Consulted (${result.sources_consulted.length}):`);
      for (const source of result.sources_consulted.slice(0, 5)) {
        const relevance = source.relevance ? ` (${(source.relevance * 100).toFixed(0)}%)` : '';
        console.log(`  • ${source.title}${relevance}`);
      }
      if (result.sources_consulted.length > 5) {
        console.log(`  ... and ${result.sources_consulted.length - 5} more`);
      }
      console.log('');
    }

    if (result.gaps_identified && result.gaps_identified.length > 0) {
      console.log(`Gaps Identified:`);
      for (const gap of result.gaps_identified) {
        console.log(`  ? ${gap}`);
      }
      console.log('');
    }

    if (result.suggested_queries && result.suggested_queries.length > 0) {
      console.log(`Suggested Follow-up Queries:`);
      for (const q of result.suggested_queries) {
        console.log(`  → ${q}`);
      }
      console.log('');
    }
  });

// ============================================================================
// Archive Command
// ============================================================================

program
  .command('archive')
  .description('Archive a project')
  .argument('<project>', 'Project name to archive')
  .option('-r, --reason <reason>', 'Reason for archiving')
  .option('-s, --successor <project>', 'Successor project name')
  .option('-d, --data-dir <dir>', 'Data directory', DEFAULT_DATA_DIR)
  .option('--no-push', 'Skip git push')
  .action(async (project, options) => {
    const { handleArchiveProject } = await import('./mcp/handlers/archive-project.js');
    const dataDir = options.dataDir;
    const dbPath = path.join(dataDir, 'lore.lance');

    const result = await handleArchiveProject(dbPath, dataDir, {
      project,
      reason: options.reason,
      successor_project: options.successor,
    }, { autoPush: options.push !== false });

    if (result.success) {
      console.log(`\n✓ Archived project "${result.project}"`);
      console.log(`  Sources affected: ${result.sources_affected}`);
      if (result.reason) console.log(`  Reason: ${result.reason}`);
      if (result.successor_project) console.log(`  Successor: ${result.successor_project}`);
      console.log(`  Synced: ${result.synced ? 'yes' : 'no'}`);
    } else {
      console.error(`\nFailed to archive: ${result.error}`);
      process.exit(1);
    }
  });

// ============================================================================
// Init Command - Set up data repository
// ============================================================================

program
  .command('init')
  .description('Initialize a new Lore data repository')
  .argument('[path]', 'Path for the data repository', '~/lore-data')
  .option('--remote <url>', 'Git remote URL for cross-machine sync')
  .action(async (targetPath, options) => {
    const { execSync } = await import('child_process');

    // Expand ~ to home directory
    const expandedPath = targetPath.replace(/^~/, process.env.HOME || '~');

    console.log(`\nLore Init`);
    console.log(`=========`);
    console.log(`Creating data repository at: ${expandedPath}\n`);

    // Create directory structure
    await mkdir(expandedPath, { recursive: true });
    await mkdir(path.join(expandedPath, 'sources'), { recursive: true });
    await mkdir(path.join(expandedPath, 'retained'), { recursive: true });

    // Create .gitignore
    const gitignore = `# Environment files
.env
.env.local
`;
    await writeFile(path.join(expandedPath, '.gitignore'), gitignore);

    // Create README
    const readme = `# Lore Data Repository

Your personal knowledge repository for Lore.

## Structure

- \`sources/\` - Ingested documents
- \`retained/\` - Explicitly saved insights

Vector embeddings are stored in Supabase (cloud) for multi-machine access.

## Usage

Set \`LORE_DATA_DIR=${expandedPath}\` in your environment or MCP config.
`;
    await writeFile(path.join(expandedPath, 'README.md'), readme);

    console.log('✓ Created directory structure');

    // Initialize git
    try {
      execSync('git init', { cwd: expandedPath, stdio: 'pipe' });
      console.log('✓ Initialized git repository');

      // Add and commit
      execSync('git add .', { cwd: expandedPath, stdio: 'pipe' });
      execSync('git commit -m "Initial lore data repository"', { cwd: expandedPath, stdio: 'pipe' });
      console.log('✓ Created initial commit');

      // Add remote if provided
      if (options.remote) {
        execSync(`git remote add origin ${options.remote}`, { cwd: expandedPath, stdio: 'pipe' });
        console.log(`✓ Added remote: ${options.remote}`);

        try {
          execSync('git push -u origin main', { cwd: expandedPath, stdio: 'pipe' });
          console.log('✓ Pushed to remote');
        } catch {
          console.log('⚠ Could not push to remote (you may need to push manually)');
        }
      }
    } catch (error) {
      console.log('⚠ Git initialization failed (git may not be installed)');
    }

    console.log(`
Done! To use this data repository:

1. Set the environment variable:
   export LORE_DATA_DIR=${expandedPath}

2. Or add to your MCP config:
   "env": { "LORE_DATA_DIR": "${expandedPath}" }

3. Ingest some sources:
   lore ingest /path/to/docs --type markdown -p my-project
`);
  });

// ============================================================================
// MCP Command
// ============================================================================

program
  .command('mcp')
  .description('Start the MCP server')
  .action(async () => {
    // Dynamic import to start MCP server
    await import('./mcp/server.js');
  });

// ============================================================================
// Helper Functions
// ============================================================================

async function buildIndex(
  dataDir: string,
  results: Array<{
    source: SourceDocument;
    notes: string;
    transcript: string;
    insights?: { summary: string; themes: Theme[]; quotes: Quote[] };
  }>
): Promise<void> {
  const dbPath = path.join(dataDir, 'lore.lance');

  // Initialize tables
  await initializeTables(dbPath);

  // Prepare source records
  const sourceRecords: Array<{ source: SourceRecord; vector: number[] }> = [];

  // Collect all texts for batch embedding (source summaries only)
  const textsToEmbed: { id: string; text: string }[] = [];

  for (const result of results) {
    const { source, insights } = result;
    const summary = insights?.summary || source.content.substring(0, 500);

    // Add summary for source embedding
    textsToEmbed.push({
      id: `source_${source.id}`,
      text: createSearchableText({ type: 'summary', text: summary, project: source.projects[0] }),
    });
  }

  // Generate embeddings in batch
  console.log(`  Generating ${textsToEmbed.length} embeddings...`);
  const embeddings = await generateEmbeddings(
    textsToEmbed.map((t) => t.text),
    undefined,
    {
      onProgress: (completed, total) => {
        process.stdout.write(`\r  Embeddings: ${completed}/${total}`);
      },
    }
  );
  console.log('');

  // Map embeddings back
  const embeddingMap = new Map<string, number[]>();
  for (let i = 0; i < textsToEmbed.length; i++) {
    embeddingMap.set(textsToEmbed[i].id, embeddings[i]);
  }

  // Build records
  for (const result of results) {
    const { source, insights } = result;
    const summary = insights?.summary || source.content.substring(0, 500);
    const themes = insights?.themes || [];

    // Source record
    sourceRecords.push({
      source: {
        id: source.id,
        title: source.title,
        source_type: source.source_type,
        content_type: source.content_type,
        projects: JSON.stringify(source.projects),
        tags: JSON.stringify(source.tags),
        created_at: source.created_at,
        summary,
        themes_json: JSON.stringify(themes),
        quotes_json: JSON.stringify([]),
        has_full_content: true,
        vector: [],
      },
      vector: embeddingMap.get(`source_${source.id}`) || [],
    });
  }

  // Store in database
  console.log(`  Storing ${sourceRecords.length} sources...`);
  await storeSources(dbPath, sourceRecords);
}

program.parse();
