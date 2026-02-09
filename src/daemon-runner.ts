#!/usr/bin/env node
/**
 * Daemon Runner
 *
 * This script runs as a background process, handling file watching and periodic sync.
 * It writes logs to ~/.config/lore/daemon.log and updates status in daemon.status.json.
 */

import path from 'path';
import os from 'os';
import { existsSync, appendFileSync, writeFileSync, readFileSync } from 'fs';
import { mkdir } from 'fs/promises';

// Config paths
const CONFIG_DIR = path.join(os.homedir(), '.config', 'lore');
const PID_FILE = path.join(CONFIG_DIR, 'daemon.pid');
const STATUS_FILE = path.join(CONFIG_DIR, 'daemon.status.json');
const LOG_FILE = path.join(CONFIG_DIR, 'daemon.log');

// Get data directory from command line arg
const dataDir = process.argv[2] || process.env.LORE_DATA_DIR || '~/.lore';
const dbPath = path.join(dataDir, 'lore.lance');

interface DaemonStatus {
  pid: number;
  started_at: string;
  last_sync?: string;
  last_sync_result?: {
    files_scanned: number;
    files_processed: number;
    errors: number;
  };
}

function log(level: string, message: string): void {
  const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const line = `[${timestamp}] ${level.padEnd(5)} ${message}\n`;
  appendFileSync(LOG_FILE, line);
}

function updateStatus(updates: Partial<DaemonStatus>): void {
  try {
    let status: DaemonStatus = {
      pid: process.pid,
      started_at: new Date().toISOString(),
    };

    if (existsSync(STATUS_FILE)) {
      const existing = JSON.parse(readFileSync(STATUS_FILE, 'utf-8'));
      // Only preserve last_sync info, always use current pid/started_at
      if (existing.last_sync) status.last_sync = existing.last_sync;
      if (existing.last_sync_result) status.last_sync_result = existing.last_sync_result;
    }

    Object.assign(status, updates);
    writeFileSync(STATUS_FILE, JSON.stringify(status, null, 2));
  } catch (error) {
    log('ERROR', `Failed to update status: ${error}`);
  }
}

async function runSync(gitPull: boolean = true): Promise<{
  files_scanned: number;
  files_processed: number;
  errors: number;
  titles: string[];
  git_pulled: boolean;
  git_pushed: boolean;
  git_error?: string;
}> {
  const { handleSync } = await import('./mcp/handlers/sync.js');

  const result = await handleSync(
    dbPath,
    dataDir,
    {
      git_pull: gitPull,
      git_push: true,
    },
    { hookContext: { mode: 'cli' } }
  );

  // Log git operation results — these were previously silent
  if (gitPull && result.git_error) {
    log('WARN', `Git pull error: ${result.git_error}`);
  }

  return {
    files_scanned: result.discovery?.total_files || 0,
    files_processed: result.processing?.processed || 0,
    errors: result.processing?.errors || 0,
    titles: result.processing?.titles || [],
    git_pulled: result.git_pulled,
    git_pushed: result.git_pushed,
    git_error: result.git_error,
  };
}

async function main(): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true });

  // Bridge config.json → process.env (critical for launchd which has no shell env)
  const { bridgeConfigToEnv } = await import('./core/config.js');
  await bridgeConfigToEnv();

  // Write PID file immediately so parent knows we started
  writeFileSync(PID_FILE, String(process.pid));

  // Also initialize status file with correct PID
  updateStatus({});

  log('START', `Daemon starting (PID: ${process.pid})`);
  log('INFO', `Data directory: ${dataDir}`);

  // Load sync config
  const { loadSyncConfig, getEnabledSources, expandPath } = await import('./sync/config.js');
  const { matchesGlob } = await import('./sync/discover.js');

  const config = await loadSyncConfig();
  const sources = getEnabledSources(config);

  if (sources.length === 0) {
    log('WARN', 'No local sync sources configured');
    log('INFO', 'Will still sync from remote');
  } else {
    for (const source of sources) {
      log('INFO', `Watching: ${source.name} (${expandPath(source.path)})`);
    }
  }

  // Initial sync
  log('SYNC', 'Running initial sync...');
  try {
    const result = await runSync(true);
    log('SYNC', `Initial sync complete: ${result.files_scanned} scanned, ${result.files_processed} processed`);
    for (const title of result.titles) {
      log('INDEX', title);
    }
    if (result.git_pushed) {
      log('PUSH', 'Changes pushed to remote');
    } else if (result.files_processed > 0) {
      log('WARN', `Git push failed after processing ${result.files_processed} file(s)${result.git_error ? `: ${result.git_error}` : ''}`);
    }
    updateStatus({
      last_sync: new Date().toISOString(),
      last_sync_result: {
        files_scanned: result.files_scanned,
        files_processed: result.files_processed,
        errors: result.errors,
      },
    });
  } catch (error) {
    log('ERROR', `Initial sync failed: ${error}`);
  }

  // Set up file watcher if we have local sources
  let isSyncing = false;
  let pendingSync = false;
  const debounceMs = 2000;
  let syncTimeout: ReturnType<typeof setTimeout> | null = null;

  async function debouncedSync(): Promise<void> {
    if (isSyncing) {
      pendingSync = true;
      return;
    }

    isSyncing = true;
    log('SYNC', 'File change detected, syncing...');

    try {
      const result = await runSync(false); // Don't git pull on file change
      log('SYNC', `Sync complete: ${result.files_processed} files processed`);
      for (const title of result.titles) {
        log('INDEX', title);
      }
      updateStatus({
        last_sync: new Date().toISOString(),
        last_sync_result: {
          files_scanned: result.files_scanned,
          files_processed: result.files_processed,
          errors: result.errors,
        },
      });
    } catch (error) {
      log('ERROR', `Sync failed: ${error}`);
    }

    isSyncing = false;

    // If another sync was requested while we were syncing, run it
    if (pendingSync) {
      pendingSync = false;
      debouncedSync();
    }
  }

  function scheduleSync(): void {
    if (syncTimeout) {
      clearTimeout(syncTimeout);
    }
    syncTimeout = setTimeout(debouncedSync, debounceMs);
  }

  // Check if a file matches any configured source glob
  function fileMatchesAnySource(filePath: string): boolean {
    for (const source of sources) {
      const expanded = expandPath(source.path);
      if (filePath.startsWith(expanded)) {
        const relativePath = path.relative(expanded, filePath);
        if (matchesGlob(relativePath, source.glob)) {
          return true;
        }
      }
    }
    return false;
  }

  // Set up file watcher
  if (sources.length > 0) {
    const chokidar = await import('chokidar');
    const watchPaths = sources.map(s => expandPath(s.path));

    const watcher = chokidar.watch(watchPaths, {
      ignored: [
        /(^|[\\/])\../, // Ignore dotfiles
        /node_modules/,
        /__pycache__/,
        /\.lance$/,
        /vectors\.lance/,
        /\.db$/,
        /\.sqlite$/,
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
        if (!fileMatchesAnySource(filePath)) return;
        log('FILE', `Added: ${path.basename(filePath)}`);
        scheduleSync();
      })
      .on('change', (filePath) => {
        if (!fileMatchesAnySource(filePath)) return;
        log('FILE', `Changed: ${path.basename(filePath)}`);
        scheduleSync();
      })
      .on('error', (error) => {
        log('ERROR', `Watcher error: ${error}`);
      });

    log('INFO', 'File watcher started');
  }

  // Periodic sync (git pull + full sync)
  const PULL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

  async function periodicSync(): Promise<void> {
    if (isSyncing) return;

    log('PULL', 'Periodic sync starting...');

    try {
      const result = await runSync(true);

      if (result.files_processed > 0) {
        log('PULL', `Found ${result.files_processed} new file(s)`);
        for (const title of result.titles) {
          log('INDEX', title);
        }
        if (result.git_pushed) {
          log('PUSH', 'Changes pushed to remote');
        } else {
          log('WARN', `Git push failed${result.git_error ? `: ${result.git_error}` : ''}`);
        }
      } else {
        log('PULL', 'Up to date');
      }

      // Detect unpushed commits (commits exist locally but weren't pushed this cycle)
      try {
        const { exec } = await import('child_process');
        const { promisify } = await import('util');
        const execAsync = promisify(exec);
        const { stdout } = await execAsync('git log --oneline @{u}..HEAD 2>/dev/null', { cwd: dataDir });
        const unpushed = stdout.trim().split('\n').filter(Boolean).length;
        if (unpushed > 0) {
          log('WARN', `${unpushed} unpushed commit(s) in data directory — run 'git -C ${dataDir} push' manually if this persists`);
        }
      } catch {
        // No upstream or not a git repo — skip check
      }

      updateStatus({
        last_sync: new Date().toISOString(),
        last_sync_result: {
          files_scanned: result.files_scanned,
          files_processed: result.files_processed,
          errors: result.errors,
        },
      });
    } catch (error) {
      log('ERROR', `Periodic sync failed: ${error}`);
    }
  }

  // Run periodic sync
  setInterval(periodicSync, PULL_INTERVAL_MS);
  log('INFO', `Periodic sync every ${PULL_INTERVAL_MS / 60000} minutes`);

  // Handle shutdown
  process.on('SIGTERM', () => {
    log('STOP', 'Daemon stopping (SIGTERM)');
    process.exit(0);
  });

  process.on('SIGINT', () => {
    log('STOP', 'Daemon stopping (SIGINT)');
    process.exit(0);
  });

  log('INFO', 'Daemon ready');
}

main().catch((error) => {
  log('FATAL', `Daemon crashed: ${error}`);
  process.exit(1);
});
