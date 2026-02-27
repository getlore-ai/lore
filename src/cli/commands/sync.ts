/**
 * Sync Command
 *
 * Registers all sync-related subcommands: one-time sync, daemon, watch, sources.
 * Implementation split across sub-modules.
 */

import type { Command } from 'commander';
import { spawn } from 'child_process';
import { existsSync, readFileSync, readdirSync } from 'fs';
import path from 'path';

import { c } from '../colors.js';

import {
  startDaemonProcess,
  restartDaemon,
  isDaemonRunning,
  getPid,
  getStatus,
  formatUptime,
  formatAgo,
  isLaunchdInstalled,
  CONFIG_DIR,
  PID_FILE,
  STATUS_FILE,
  LOG_FILE,
} from './sync-daemon.js';
import type { DaemonStatus } from './sync-daemon.js';
import { uninstallLaunchdAgent } from './sync-launchd.js';

// Re-export for external consumers (daemon-runner, browse, etc.)
export {
  startDaemonProcess,
  restartDaemon,
  isDaemonRunning,
  CONFIG_DIR,
  PID_FILE,
  STATUS_FILE,
  LOG_FILE,
};
export type { DaemonStatus };

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

      const result = await handleSync(
        dbPath,
        dataDir,
        {
          git_pull: options.git !== false,
          git_push: options.git !== false,
          dry_run: options.dryRun,
          use_legacy: options.legacy,
        },
        { hookContext: { mode: 'cli' } }
      );

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
          console.log(`  ⚠ ${result.processing.errors} file(s) failed to process (check logs above)`);
        }
      }

      if (result.sources_found > 0 || result.sources_indexed > 0) {
        console.log(`\nLegacy Sync:`);
        console.log(`  Sources on disk: ${result.sources_found}`);
        console.log(`  Newly indexed: ${result.sources_indexed}`);
        console.log(`  Already indexed: ${result.already_indexed}`);
      }

      if (result.reconciled > 0) {
        console.log(`\nReconciled ${result.reconciled} source(s) missing local content`);
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
      const result = await startDaemonProcess(options.dataDir);

      if (!result) {
        console.error('Failed to start daemon - check logs with: lore sync logs');
        return;
      }

      if (result.alreadyRunning) {
        console.log(`Daemon already running (PID: ${result.pid})`);
        console.log(`Use "lore sync status" to check status`);
        console.log(`Use "lore sync stop" to stop it`);
        return;
      }

      console.log(`Daemon started (PID: ${result.pid})`);
      console.log(`Log file: ${LOG_FILE}`);
      console.log(`Use "lore sync logs" to view activity`);
    });

  // Stop daemon
  syncCmd
    .command('stop')
    .description('Stop background sync daemon')
    .action(async () => {
      // Uninstall launchd agent so the daemon doesn't restart on login
      if (isLaunchdInstalled()) {
        uninstallLaunchdAgent();
      }

      const pid = getPid();
      if (!pid) {
        console.log('Daemon is not running');
        return;
      }

      try {
        process.kill(pid, 'SIGTERM');
        console.log(`Daemon stopped (PID: ${pid})`);
        const { unlinkSync } = await import('fs');
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
      const result = await restartDaemon(options.dataDir);

      if (!result) {
        console.error('Failed to restart daemon - check logs with: lore sync logs');
        return;
      }

      console.log(`Daemon restarted (PID: ${result.pid})`);
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
        console.log(`Auto-start: ${isLaunchdInstalled() ? 'enabled (launchd)' : 'not configured'}`);
        console.log('');
        console.log('Start with: lore sync start');
        return;
      }

      console.log(`Daemon: RUNNING (PID: ${pid})`);
      console.log(`Auto-start: ${isLaunchdInstalled() ? 'enabled (launchd)' : 'not configured'}`);

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
      const { watchAction } = await import('./sync-watch.js');
      await watchAction(options);
    });

  // Source management (flat, not nested under "sources")
  syncCmd
    .command('list')
    .description('List configured sync sources')
    .action(async () => {
      const { loadSyncConfig, getConfigPath } = await import('../../sync/config.js');

      console.log('');
      console.log(`  ${c.title('Sync Sources')}`);
      console.log(`  ${c.dim('━'.repeat(12))}`);
      console.log('');

      const config = await loadSyncConfig();

      if (config.sources.length === 0) {
        console.log(c.dim('  No sources configured.'));
        console.log(`  Run ${c.bold('lore sync add')} to add one.`);
        console.log('');
        return;
      }

      for (const source of config.sources) {
        if (source.enabled) {
          console.log(`  ${c.success('✓')} ${c.bold(source.name)}`);
        } else {
          console.log(`  ${c.dim('○')} ${c.dim(source.name + ' (disabled)')}`);
        }
        console.log(`    Path:    ${source.path}`);
        console.log(`    Glob:    ${c.dim(source.glob)}`);
        console.log(`    Project: ${source.project}`);
        console.log('');
      }

      console.log(c.dim(`  Config: ${getConfigPath()}`));
      console.log(c.dim(`  Add more with: lore sync add`));
      console.log('');
    });

  syncCmd
    .command('add')
    .description('Add a new sync source directory')
    .option('-n, --name <name>', 'Source name')
    .option('-p, --path <path>', 'Directory path')
    .option('-g, --glob <glob>', 'File glob pattern', '**/*')
    .option('--project <project>', 'Default project')
    .action(async (options) => {
      const { addSyncSource, expandPath } = await import('../../sync/config.js');

      // Non-interactive: path and project provided
      const nonInteractive = !!(options.path && options.project);

      if (nonInteractive) {
        const dirBase = path.basename(expandPath(options.path)) || 'Source';
        const name = options.name || dirBase.charAt(0).toUpperCase() + dirBase.slice(1);
        try {
          await addSyncSource({
            name,
            path: options.path,
            glob: options.glob || '**/*',
            project: options.project,
            enabled: true,
          });
          console.log(`\n  ${c.success('✓')} Added "${name}"`);
          console.log(`    Path:    ${options.path}`);
          console.log(`    Glob:    ${options.glob || '**/*'}`);
          console.log(`    Project: ${options.project}`);
          console.log(`\n  Run ${c.bold("'lore sync'")} to index these files now.\n`);
        } catch (error) {
          console.error(`\nError: ${error}`);
          process.exit(1);
        }
        return;
      }

      // Interactive flow: path → project → done
      const readline = await import('readline');
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      const ask = (question: string, defaultValue?: string): Promise<string> =>
        new Promise((resolve) => {
          const prompt = defaultValue ? `  ${question} [${defaultValue}]: ` : `  ${question}: `;
          rl.question(prompt, (answer) => {
            resolve(answer.trim() || defaultValue || '');
          });
        });

      console.log('');

      // Path
      const sourcePath = options.path || await ask('Path');
      if (!sourcePath) {
        rl.close();
        console.log(c.warning('\n  Path is required.\n'));
        process.exit(1);
      }

      // Validate path
      const resolved = expandPath(sourcePath);
      if (existsSync(resolved)) {
        try {
          const count = readdirSync(resolved).length;
          console.log(c.success(`  ✓ Found (${count} items)`));
        } catch {
          console.log(c.success('  ✓ Directory exists'));
        }
      } else {
        console.log(c.warning('  ⚠ Directory does not exist yet'));
      }

      // Derive name from directory basename
      const dirName = path.basename(resolved) || 'Source';
      const defaultName = options.name || dirName.charAt(0).toUpperCase() + dirName.slice(1);
      const defaultProject = options.project || dirName.toLowerCase().replace(/[^a-z0-9-]/g, '-');

      // Project
      const project = await ask('Project', defaultProject);
      if (!project) {
        rl.close();
        console.log(c.warning('\n  Project is required.\n'));
        process.exit(1);
      }

      rl.close();

      const name = options.name || defaultName;
      const glob = options.glob || '**/*';

      try {
        await addSyncSource({
          name,
          path: sourcePath,
          glob,
          project,
          enabled: true,
        });

        console.log('');
        console.log(`  ${c.success('✓')} Added "${c.bold(name)}"`);
        console.log(`    Path:    ${sourcePath}`);
        console.log(`    Glob:    ${c.dim(glob)}`);
        console.log(`    Project: ${project}`);
        console.log('');
        console.log(`  Run ${c.bold("'lore sync'")} to index these files now.`);
        console.log('');
      } catch (error) {
        console.error(`\n  ${c.error(String(error))}\n`);
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

}
