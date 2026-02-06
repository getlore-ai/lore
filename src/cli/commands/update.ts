/**
 * Update Command
 *
 * Check for and install updates to @getlore/cli.
 * Restarts the background daemon after upgrading so it picks up new code.
 */

import type { Command } from 'commander';
import { spawnSync } from 'child_process';
import { c } from '../colors.js';
import { getLoreVersionString } from '../../extensions/registry.js';
import { restartDaemon, isDaemonRunning } from './sync.js';

const NPM_PACKAGE = '@getlore/cli';

function getLatestVersion(): string | null {
  const result = spawnSync('npm', ['view', NPM_PACKAGE, 'version'], {
    encoding: 'utf-8',
    timeout: 10_000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0 || !result.stdout) return null;
  return result.stdout.trim();
}

export function registerUpdateCommand(program: Command, defaultDataDir: string): void {
  program
    .command('update')
    .description('Check for and install updates')
    .option('--check', 'Check for updates without installing')
    .action(async (options) => {
      const currentVersion = (await getLoreVersionString()) || 'unknown';
      console.log(`\nCurrent version: ${c.bold(currentVersion)}`);

      console.log('Checking npm for latest version...');
      const latestVersion = getLatestVersion();

      if (!latestVersion) {
        console.error('Could not check npm registry. Are you online?');
        process.exit(1);
      }

      console.log(`Latest version:  ${c.bold(latestVersion)}`);

      if (currentVersion === latestVersion) {
        console.log(c.success('\nAlready up to date!'));
        return;
      }

      console.log(`\nUpdate available: ${c.dim(currentVersion)} → ${c.success(latestVersion)}`);

      if (options.check) {
        console.log(`\nRun ${c.bold('lore update')} to install.`);
        return;
      }

      // Install
      console.log(`\nInstalling ${NPM_PACKAGE}@${latestVersion}...`);
      const installResult = spawnSync('npm', ['install', '-g', `${NPM_PACKAGE}@latest`], {
        stdio: 'inherit',
        timeout: 120_000,
      });

      if (installResult.status !== 0) {
        console.error('\nInstallation failed. You may need to run with sudo:');
        console.error(`  sudo npm install -g ${NPM_PACKAGE}@latest`);
        process.exit(1);
      }

      console.log(c.success(`\nUpdated to ${latestVersion}!`));

      // Restart daemon if running
      if (isDaemonRunning()) {
        console.log('\nRestarting background daemon...');
        const result = await restartDaemon(defaultDataDir);
        if (result) {
          console.log(c.success(`Daemon restarted (PID: ${result.pid})`));
        } else {
          console.log(c.warning('Could not restart daemon. Run: lore sync restart'));
        }
      }

      console.log('');
    });
}
