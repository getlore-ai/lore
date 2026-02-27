/**
 * Sync - Watch
 *
 * Foreground watch mode: watches directories and syncs on file changes.
 */

import path from 'path';

import { colors, c } from '../colors.js';

export async function watchAction(options: {
  dataDir: string;
  interval: string;
  initial: boolean | undefined;
}): Promise<void> {
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
      const result = await handleSync(
        dbPath,
        dataDir,
        {
          git_pull: true,
          git_push: true,
        },
        { hookContext: { mode: 'cli' } }
      );

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
      const result = await handleSync(
        dbPath,
        dataDir,
        {
          git_pull: false,
          git_push: true,
        },
        { hookContext: { mode: 'cli' } }
      );

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
      const result = await handleSync(
        dbPath,
        dataDir,
        {
          git_pull: true,
          git_push: false,
        },
        { hookContext: { mode: 'cli' } }
      );

      if (result.git_pulled) {
        console.log(`  ${c.time(ts)} ${c.success('✓')} Pulled latest changes`);
      }

      const newFiles = result.discovery?.new_files || 0;
      if (newFiles > 0) {
        console.log(`  ${c.time(ts)} ${c.info('→')} Found ${newFiles} new file(s) from remote`);
        const processResult = await handleSync(
          dbPath,
          dataDir,
          {
            git_pull: false,
            git_push: true,
          },
          { hookContext: { mode: 'cli' } }
        );
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
}
