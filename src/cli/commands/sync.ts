/**
 * Sync Command
 *
 * All sync-related functionality: one-time sync, daemon, watch, sources.
 */

import type { Command } from 'commander';
import { spawn, spawnSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync, unlinkSync, appendFileSync } from 'fs';
import { mkdir } from 'fs/promises';
import path from 'path';
import os from 'os';

import { fileURLToPath } from 'url';
import { colors, c } from '../colors.js';

// Get the directory of this module (for finding daemon-runner.js)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Config directory for daemon files
const CONFIG_DIR = path.join(os.homedir(), '.config', 'lore');
const PID_FILE = path.join(CONFIG_DIR, 'daemon.pid');
const STATUS_FILE = path.join(CONFIG_DIR, 'daemon.status.json');
const LOG_FILE = path.join(CONFIG_DIR, 'daemon.log');

export interface DaemonStatus {
  pid: number;
  started_at: string;
  last_sync?: string;
  last_sync_result?: {
    files_scanned: number;
    files_processed: number;
    errors: number;
  };
}

async function ensureConfigDir(): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true });
}

function getPid(): number | null {
  if (!existsSync(PID_FILE)) return null;
  try {
    const pid = parseInt(readFileSync(PID_FILE, 'utf-8').trim(), 10);
    try {
      process.kill(pid, 0);
      return pid;
    } catch {
      unlinkSync(PID_FILE);
      return null;
    }
  } catch {
    return null;
  }
}

function getStatus(): DaemonStatus | null {
  if (!existsSync(STATUS_FILE)) return null;
  try {
    return JSON.parse(readFileSync(STATUS_FILE, 'utf-8'));
  } catch {
    return null;
  }
}

function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

function formatAgo(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function registerSyncCommand(program: Command, defaultDataDir: string): void {
  const syncCmd = program
    .command('sync')
    .description('Sync and manage the knowledge repository')
    .option('-d, --data-dir <dir>', 'Data directory', defaultDataDir)
    .option('--dry-run', 'Show what would be synced without processing')
    .option('--legacy', 'Use legacy disk-based sync only')
    .option('--no-git', 'Skip git operations')
    .action(async (options) => {
      // Default action: one-time sync
      const { handleSync } = await import('../../mcp/handlers/sync.js');

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

      if (result.git_pulled) {
        console.log('✓ Pulled latest changes from git');
      }
      if (result.git_error) {
        console.log(`⚠ Git: ${result.git_error}`);
      }

      if (result.discovery) {
        console.log(`\nDiscovery:`);
        console.log(`  Sources scanned: ${result.discovery.sources_scanned}`);
        console.log(`  Files found: ${result.discovery.total_files}`);
        console.log(`  New files: ${result.discovery.new_files}`);
        if (result.discovery.edited_files && result.discovery.edited_files > 0) {
          console.log(`  Edited files: ${result.discovery.edited_files}`);
        }
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

  // Start daemon
  syncCmd
    .command('start')
    .description('Start background sync daemon')
    .option('-d, --data-dir <dir>', 'Data directory', defaultDataDir)
    .action(async (options) => {
      await ensureConfigDir();

      const existingPid = getPid();
      if (existingPid) {
        console.log(`Daemon already running (PID: ${existingPid})`);
        console.log(`Use "lore sync status" to check status`);
        console.log(`Use "lore sync stop" to stop it`);
        return;
      }

      // Use import.meta.url to find daemon-runner.js correctly even via npm link
      // From dist/cli/commands/sync.js -> dist/daemon-runner.js
      const scriptPath = path.join(__dirname, '..', '..', 'daemon-runner.js');
      const nodePath = process.execPath;

      // Write a temporary shell script to start the daemon
      // This avoids issues with Node.js spawn and process detachment on macOS
      const tmpScript = path.join(os.tmpdir(), `lore-daemon-start-${Date.now()}.sh`);
      const scriptContent = `#!/bin/bash
nohup "${nodePath}" "${scriptPath}" "${options.dataDir}" > /dev/null 2>&1 &
`;
      writeFileSync(tmpScript, scriptContent, { mode: 0o755 });

      // Execute the script synchronously
      spawnSync('/bin/bash', [tmpScript], {
        stdio: 'ignore',
      });

      // Clean up temp script
      try { unlinkSync(tmpScript); } catch {}

      // Wait for daemon to start and write PID file
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Read the PID that daemon wrote
      let daemonPid: number | null = null;
      try {
        daemonPid = parseInt(readFileSync(PID_FILE, 'utf-8').trim(), 10);
        // Verify process is running
        process.kill(daemonPid, 0);
      } catch {
        console.error('Failed to start daemon - check logs with: lore sync logs');
        return;
      }

      console.log(`Daemon started (PID: ${daemonPid})`);
      console.log(`Log file: ${LOG_FILE}`);
      console.log(`Use "lore sync logs" to view activity`);
    });

  // Stop daemon
  syncCmd
    .command('stop')
    .description('Stop background sync daemon')
    .action(async () => {
      const pid = getPid();
      if (!pid) {
        console.log('Daemon is not running');
        return;
      }

      try {
        process.kill(pid, 'SIGTERM');
        console.log(`Daemon stopped (PID: ${pid})`);
        if (existsSync(PID_FILE)) unlinkSync(PID_FILE);
      } catch (error) {
        console.error(`Failed to stop daemon: ${error}`);
      }
    });

  // Restart daemon
  syncCmd
    .command('restart')
    .description('Restart background sync daemon')
    .option('-d, --data-dir <dir>', 'Data directory', defaultDataDir)
    .action(async (options) => {
      const pid = getPid();
      if (pid) {
        try {
          process.kill(pid, 'SIGTERM');
          console.log(`Stopped existing daemon (PID: ${pid})`);
          if (existsSync(PID_FILE)) unlinkSync(PID_FILE);
          await new Promise(resolve => setTimeout(resolve, 500));
        } catch {
          // Process might already be dead
        }
      }

      await ensureConfigDir();

      // Use import.meta.url to find daemon-runner.js correctly even via npm link
      const scriptPath = path.join(__dirname, '..', '..', 'daemon-runner.js');
      const nodePath = process.execPath;

      // Write a temporary shell script to start the daemon
      const tmpScript = path.join(os.tmpdir(), `lore-daemon-start-${Date.now()}.sh`);
      const scriptContent = `#!/bin/bash
nohup "${nodePath}" "${scriptPath}" "${options.dataDir}" > /dev/null 2>&1 &
`;
      writeFileSync(tmpScript, scriptContent, { mode: 0o755 });

      // Execute the script synchronously
      spawnSync('/bin/bash', [tmpScript], {
        stdio: 'ignore',
      });

      // Clean up temp script
      try { unlinkSync(tmpScript); } catch {}

      // Wait for daemon to start and write PID file
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Read the PID that daemon wrote
      let daemonPid: number | null = null;
      try {
        daemonPid = parseInt(readFileSync(PID_FILE, 'utf-8').trim(), 10);
        process.kill(daemonPid, 0);
      } catch {
        console.error('Failed to restart daemon - check logs with: lore sync logs');
        return;
      }

      console.log(`Daemon restarted (PID: ${daemonPid})`);
    });

  // Daemon status
  syncCmd
    .command('status')
    .description('Check sync daemon status')
    .action(async () => {
      const pid = getPid();
      const status = getStatus();

      console.log('');
      console.log('Lore Sync Status');
      console.log('================');

      if (!pid) {
        console.log('Daemon: NOT RUNNING');
        console.log('');
        console.log('Start with: lore sync start');
        return;
      }

      console.log(`Daemon: RUNNING (PID: ${pid})`);

      if (status) {
        const started = new Date(status.started_at);
        const uptime = formatUptime(Date.now() - started.getTime());
        console.log(`Uptime: ${uptime}`);

        if (status.last_sync) {
          const lastSync = new Date(status.last_sync);
          const ago = formatAgo(Date.now() - lastSync.getTime());
          console.log(`Last sync: ${ago}`);

          if (status.last_sync_result) {
            const r = status.last_sync_result;
            console.log(`  Files scanned: ${r.files_scanned}`);
            console.log(`  Files processed: ${r.files_processed}`);
            if (r.errors > 0) {
              console.log(`  Errors: ${r.errors}`);
            }
          }
        } else {
          console.log('Last sync: (not yet synced)');
        }
      }

      console.log('');
      console.log(`Log file: ${LOG_FILE}`);
      console.log('View logs: lore sync logs');
    });

  // Daemon logs
  syncCmd
    .command('logs')
    .description('View sync daemon logs')
    .option('-f, --follow', 'Follow log output (like tail -f)')
    .option('-n, --lines <n>', 'Number of lines to show', '50')
    .action(async (options) => {
      if (!existsSync(LOG_FILE)) {
        console.log('No log file found. Daemon may not have run yet.');
        console.log(`Expected: ${LOG_FILE}`);
        return;
      }

      if (options.follow) {
        const tail = spawn('tail', ['-f', LOG_FILE], {
          stdio: 'inherit',
        });

        process.on('SIGINT', () => {
          tail.kill();
          process.exit(0);
        });

        await new Promise(() => {});
      } else {
        const content = readFileSync(LOG_FILE, 'utf-8');
        const lines = content.trim().split('\n');
        const n = parseInt(options.lines, 10);
        const lastLines = lines.slice(-n);

        console.log(`Last ${Math.min(n, lastLines.length)} log entries:\n`);
        console.log(lastLines.join('\n'));
      }
    });

  // Watch (foreground)
  syncCmd
    .command('watch')
    .description('Watch directories and sync in foreground (shows live output)')
    .option('-d, --data-dir <dir>', 'Data directory', defaultDataDir)
    .option('--interval <ms>', 'Debounce interval in ms', '2000')
    .option('--no-initial', 'Skip initial sync on startup')
    .action(async (options) => {
      const chokidar = await import('chokidar');
      const { loadSyncConfig, getEnabledSources, expandPath } = await import('../../sync/config.js');
      const { handleSync } = await import('../../mcp/handlers/sync.js');
      const { matchesGlob } = await import('../../sync/discover.js');

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

      const config = await loadSyncConfig();
      const sources = getEnabledSources(config);

      const watchPaths: string[] = [];
      if (sources.length === 0) {
        console.log(c.warning('  ⚠ No local sync sources configured'));
        console.log(c.dim('    Will still pull from remote and process new files'));
        console.log(c.dim('    Run "lore sync sources add" to watch local directories'));
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

      async function runSync() {
        if (isSyncing) return;
        isSyncing = true;

        const changes = Array.from(pendingChanges.values());
        pendingChanges.clear();

        const ts = getTimestamp();
        console.log(`  ${c.time(ts)} ${c.badge('SYNC', colors.bgBlue)} Processing ${changes.length} file(s)...`);

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
      let watcher: ReturnType<typeof chokidar.watch> | null = null;
      if (watchPaths.length > 0) {
        watcher = chokidar.watch(watchPaths, {
          ignored: [
            /(^|[\\/])\../,
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
            const ts = getTimestamp();
            console.log(`  ${c.time(ts)} ${c.success('+')} ${c.file(path.basename(filePath))} ${c.dim('added')}`);
            scheduleSync(filePath, 'add');
          })
          .on('change', (filePath) => {
            if (!fileMatchesAnySource(filePath)) return;
            const ts = getTimestamp();
            console.log(`  ${c.time(ts)} ${c.warning('~')} ${c.file(path.basename(filePath))} ${c.dim('modified')}`);
            scheduleSync(filePath, 'change');
          })
          .on('error', (error) => {
            console.log(`  ${c.error('WATCHER ERROR')} ${error}`);
          });
      }

      // Periodic sync
      const PULL_INTERVAL_MS = 5 * 60 * 1000;

      async function periodicSync() {
        if (isSyncing) return;

        const ts = getTimestamp();
        console.log(`  ${c.time(ts)} ${c.badge('PULL', colors.bgBlue)} Checking for remote changes...`);

        try {
          const result = await handleSync(dbPath, dataDir, {
            git_pull: true,
            git_push: false,
          });

          if (result.git_pulled) {
            console.log(`  ${c.time(ts)} ${c.success('✓')} Pulled latest changes`);
          }

          const newFiles = result.discovery?.new_files || 0;
          if (newFiles > 0) {
            console.log(`  ${c.time(ts)} ${c.info('→')} Found ${newFiles} new file(s) from remote`);
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

      console.log(`  ${c.dim(`Remote sync every ${PULL_INTERVAL_MS / 60000} minutes`)}`);
      console.log('');

      await periodicSync();
      const pullInterval = setInterval(periodicSync, PULL_INTERVAL_MS);

      // Handle shutdown
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

  // Source management (flat, not nested under "sources")
  syncCmd
    .command('list')
    .description('List configured sync sources')
    .action(async () => {
      const { loadSyncConfig, getConfigPath } = await import('../../sync/config.js');

      console.log(`\nSync Sources`);
      console.log(`============`);
      console.log(`Config: ${getConfigPath()}\n`);

      const config = await loadSyncConfig();

      if (config.sources.length === 0) {
        console.log('No sources configured. Run "lore sync add" to add one.');
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

  syncCmd
    .command('add')
    .description('Add a new sync source directory')
    .option('-n, --name <name>', 'Source name')
    .option('-p, --path <path>', 'Directory path')
    .option('-g, --glob <glob>', 'File glob pattern', '**/*.md')
    .option('--project <project>', 'Default project')
    .action(async (options) => {
      const { addSyncSource } = await import('../../sync/config.js');
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

  syncCmd
    .command('enable <name>')
    .description('Enable a sync source')
    .action(async (name) => {
      const { updateSyncSource } = await import('../../sync/config.js');

      try {
        await updateSyncSource(name, { enabled: true });
        console.log(`✓ Enabled "${name}"`);
      } catch (error) {
        console.error(`Error: ${error}`);
        process.exit(1);
      }
    });

  syncCmd
    .command('disable <name>')
    .description('Disable a sync source')
    .action(async (name) => {
      const { updateSyncSource } = await import('../../sync/config.js');

      try {
        await updateSyncSource(name, { enabled: false });
        console.log(`✓ Disabled "${name}"`);
      } catch (error) {
        console.error(`Error: ${error}`);
        process.exit(1);
      }
    });

  syncCmd
    .command('remove <name>')
    .description('Remove a sync source')
    .action(async (name) => {
      const { removeSyncSource } = await import('../../sync/config.js');

      try {
        await removeSyncSource(name);
        console.log(`✓ Removed "${name}"`);
      } catch (error) {
        console.error(`Error: ${error}`);
        process.exit(1);
      }
    });

  // Import (legacy bulk import)
  syncCmd
    .command('import')
    .description('Bulk import files from a directory (legacy)')
    .argument('<path>', 'Path to source file or directory')
    .option('-t, --type <type>', 'Source type (granola, claude-code, markdown)', 'markdown')
    .option('-p, --project <project>', 'Associate with project')
    .option('--tags <tags>', 'Comma-separated tags')
    .option('-d, --data-dir <dir>', 'Data directory', defaultDataDir)
    .option('--skip-indexing', 'Skip vector indexing (run sync later)')
    .action(async (sourcePath, options) => {
      const dataDir = options.dataDir;
      const dbPath = path.join(dataDir, 'lore.lance');
      const sourcesDir = path.join(dataDir, 'sources');

      console.log(`\nLore Import`);
      console.log(`===========`);
      console.log(`Source: ${sourcePath}`);
      console.log(`Type: ${options.type}`);
      console.log(`Project: ${options.project || '(none)'}`);
      console.log(`Data dir: ${dataDir}\n`);

      // Ensure directories exist
      await mkdir(sourcesDir, { recursive: true });

      const { buildIndex, saveSourcesToDisk } = await import('../helpers.js');
      const { getAllSources, indexExists } = await import('../../core/vector-store.js');

      // Check for existing sources
      const existingIds: string[] = [];
      if (await indexExists(dbPath)) {
        const existing = await getAllSources(dbPath, {});
        existingIds.push(...existing.map((s) => s.id));
      }

      if (options.type === 'granola') {
        const { ingestGranolaExports, listGranolaExports } = await import('../../ingest/granola.js');

        const exports = await listGranolaExports(sourcePath);
        console.log(`Found ${exports.length} Granola exports\n`);

        if (exports.length === 0) {
          console.log('No exports found.');
          process.exit(1);
        }

        const newExports = exports.filter((e) => !existingIds.includes(e.id));
        console.log(`New sources to import: ${newExports.length}`);
        console.log(`Already indexed: ${existingIds.length}\n`);

        if (newExports.length === 0) {
          console.log('All sources already imported.');
          return;
        }

        console.log('Importing sources...');
        const results = await ingestGranolaExports(sourcePath, {
          project: options.project,
          extractInsightsEnabled: true,
          skipExisting: existingIds,
          onProgress: (current: number, total: number, title: string) => {
            process.stdout.write(`\r  [${current}/${total}] ${title.substring(0, 50).padEnd(50)}`);
          },
        });
        console.log('\n');

        await saveSourcesToDisk(sourcesDir, results);
        console.log(`Saved ${results.length} sources to ${sourcesDir}\n`);

        if (!options.skipIndexing) {
          console.log('Building vector index...');
          await buildIndex(dataDir, results);
          console.log('Done!\n');
        }

        console.log(`\nImported ${results.length} sources.`);

      } else if (options.type === 'claude-code') {
        const { ingestClaudeCodeConversations, listClaudeCodeConversations } = await import('../../ingest/claude-code.js');

        const conversations = await listClaudeCodeConversations(sourcePath);
        console.log(`Found ${conversations.length} Claude Code conversations\n`);

        if (conversations.length === 0) {
          console.log('No conversations found.');
          process.exit(1);
        }

        const newConversations = conversations.filter((c) => !existingIds.includes(c.id));
        console.log(`New conversations to import: ${newConversations.length}`);
        console.log(`Already indexed: ${existingIds.length}\n`);

        if (newConversations.length === 0) {
          console.log('All conversations already imported.');
          return;
        }

        console.log('Importing conversations...');
        const results = await ingestClaudeCodeConversations(sourcePath, {
          project: options.project,
          extractInsightsEnabled: true,
          skipExisting: existingIds,
          onProgress: (current: number, total: number, title: string) => {
            process.stdout.write(`\r  [${current}/${total}] ${title.substring(0, 50).padEnd(50)}`);
          },
        });
        console.log('\n');

        await saveSourcesToDisk(sourcesDir, results);
        console.log(`Saved ${results.length} sources to ${sourcesDir}\n`);

        if (!options.skipIndexing) {
          console.log('Building vector index...');
          await buildIndex(dataDir, results.map((r) => ({
            source: r.source,
            notes: '',
            transcript: '',
            insights: r.insights,
          })));
          console.log('Done!\n');
        }

        console.log(`\nImported ${results.length} conversations.`);

      } else if (options.type === 'markdown') {
        const { ingestMarkdownDirectory, listMarkdownFiles } = await import('../../ingest/markdown.js');

        const files = await listMarkdownFiles(sourcePath);
        console.log(`Found ${files.length} markdown files\n`);

        if (files.length === 0) {
          console.log('No markdown files found.');
          process.exit(1);
        }

        console.log(`Already indexed: ${existingIds.length}\n`);

        console.log('Importing markdown files...');
        const tagsStr = options.tags as string | undefined;
        const results = await ingestMarkdownDirectory(sourcePath, {
          project: options.project,
          tags: tagsStr?.split(',').map((t: string) => t.trim()),
          extractInsightsEnabled: true,
          skipExisting: existingIds,
          onProgress: (current: number, total: number, title: string) => {
            process.stdout.write(`\r  [${current}/${total}] ${title.substring(0, 50).padEnd(50)}`);
          },
        });
        console.log('\n');

        await saveSourcesToDisk(sourcesDir, results);
        console.log(`Saved ${results.length} sources to ${sourcesDir}\n`);

        if (!options.skipIndexing) {
          console.log('Building vector index...');
          await buildIndex(dataDir, results.map((r) => ({
            source: r.source,
            notes: '',
            transcript: '',
            insights: r.insights,
          })));
          console.log('Done!\n');
        }

        console.log(`\nImported ${results.length} markdown files.`);

      } else {
        console.log(`Source type "${options.type}" not supported.`);
        console.log('Supported types: granola, claude-code, markdown');
        process.exit(1);
      }
    });
}

// Export for daemon-runner and browse
export { CONFIG_DIR, PID_FILE, STATUS_FILE, LOG_FILE };
