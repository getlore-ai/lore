/**
 * Extension Management Commands
 *
 * lore extension install|list|remove
 */

import type { Command } from 'commander';
import path from 'path';
import { readFile } from 'fs/promises';
import { promisify } from 'util';
import { exec } from 'child_process';

import {
  addExtensionToConfig,
  removeExtensionFromConfig,
  loadExtensionConfig,
  ensureExtensionsDir,
  getExtensionsDir,
} from '../../extensions/config.js';

const execAsync = promisify(exec);

async function readInstalledVersion(extensionsDir: string, packageName: string): Promise<string | undefined> {
  try {
    const pkgPath = path.join(extensionsDir, 'node_modules', packageName, 'package.json');
    const content = await readFile(pkgPath, 'utf-8');
    const parsed = JSON.parse(content) as { version?: string };
    return parsed.version;
  } catch {
    return undefined;
  }
}

export function registerExtensionCommands(program: Command): void {
  const extension = program
    .command('extension')
    .description('Manage Lore extensions');

  extension
    .command('list')
    .description('List installed extensions')
    .action(async () => {
      const config = await loadExtensionConfig();

      if (config.extensions.length === 0) {
        console.log('No extensions installed.');
        return;
      }

      console.log('Installed extensions:');
      for (const ext of config.extensions) {
        const status = ext.enabled === false ? 'disabled' : 'enabled';
        const version = ext.version ? `@${ext.version}` : '';
        console.log(`  - ${ext.name}${version} (${status})`);
      }
    });

  extension
    .command('install')
    .description('Install an extension from npm')
    .argument('<package>', 'npm package name')
    .action(async (packageName) => {
      const extensionsDir = getExtensionsDir();
      await ensureExtensionsDir();

      console.log(`Installing ${packageName}...`);
      await execAsync(`npm install ${packageName}`, { cwd: extensionsDir });

      const version = await readInstalledVersion(extensionsDir, packageName);
      await addExtensionToConfig(packageName, version);

      console.log(`✓ Installed ${packageName}${version ? `@${version}` : ''}`);
    });

  extension
    .command('remove')
    .description('Remove an installed extension')
    .argument('<package>', 'npm package name')
    .action(async (packageName) => {
      const extensionsDir = getExtensionsDir();
      await ensureExtensionsDir();

      console.log(`Removing ${packageName}...`);
      await execAsync(`npm remove ${packageName}`, { cwd: extensionsDir });

      await removeExtensionFromConfig(packageName);
      console.log(`✓ Removed ${packageName}`);
    });
}
