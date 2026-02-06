/**
 * Extension Management Commands
 *
 * lore extension install|list|remove
 */

import type { Command } from 'commander';
import path from 'path';
import os from 'os';
import { readFile, stat } from 'fs/promises';
import { promisify } from 'util';
import { exec, spawn } from 'child_process';

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

function resolveExtensionPath(inputPath: string): string {
  if (inputPath.startsWith('~')) {
    return path.resolve(path.join(os.homedir(), inputPath.slice(1)));
  }
  return path.resolve(inputPath);
}

export function registerExtensionCommands(program: Command, defaultDataDir?: string): Command {
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
    .command('dev')
    .description('Link a local extension for development')
    .argument('<path>', 'local path to extension')
    .option('--serve', 'start lore serve --watch after install')
    .action(async (inputPath: string, options: { serve?: boolean }) => {
      const extensionsDir = getExtensionsDir();
      await ensureExtensionsDir();

      const resolvedPath = resolveExtensionPath(inputPath);

      try {
        await stat(resolvedPath);
      } catch {
        console.error(`Path does not exist: ${inputPath}`);
        process.exit(1);
      }

      let packageName: string | undefined;
      let packageVersion: string | undefined;
      try {
        const pkgPath = path.join(resolvedPath, 'package.json');
        const content = await readFile(pkgPath, 'utf-8');
        const parsed = JSON.parse(content) as { name?: string; version?: string };
        packageName = parsed.name;
        packageVersion = parsed.version;
      } catch {
        console.error(`No package.json found in: ${inputPath}`);
        process.exit(1);
      }

      if (!packageName) {
        console.error(`package.json is missing a name in: ${inputPath}`);
        process.exit(1);
      }

      console.log(`Installing from ${inputPath}...`);
      await execAsync(`npm install ${resolvedPath}`, { cwd: extensionsDir });

      await addExtensionToConfig(packageName, packageVersion);

      console.log(`✓ Linked ${packageName}${packageVersion ? `@${packageVersion}` : ''}`);

      if (options.serve) {
        console.log('Starting lore serve --watch...');
        const child = spawn('lore serve --watch', { cwd: process.cwd(), stdio: 'inherit', shell: true });
        await new Promise<void>((resolve, reject) => {
          child.on('exit', code => {
            if (code === 0) {
              resolve();
            } else {
              reject(new Error(`lore serve --watch exited with code ${code ?? 'unknown'}`));
            }
          });
          child.on('error', reject);
        });
        return;
      }

      console.log('\nTo test: lore serve --watch');
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

  extension
    .command('update')
    .description('Update an extension to the latest version')
    .argument('[package]', 'npm package name (or update all if omitted)')
    .action(async (packageName?: string) => {
      const extensionsDir = getExtensionsDir();
      await ensureExtensionsDir();
      const config = await loadExtensionConfig();

      if (packageName) {
        // Update single extension
        const ext = config.extensions.find(e => e.name === packageName);
        if (!ext) {
          console.error(`Extension ${packageName} is not installed.`);
          process.exit(1);
        }
        console.log(`Updating ${packageName}...`);
        await execAsync(`npm update ${packageName}`, { cwd: extensionsDir });
        const newVersion = await readInstalledVersion(extensionsDir, packageName);
        await addExtensionToConfig(packageName, newVersion);
        console.log(`✓ Updated ${packageName}${newVersion ? ` to ${newVersion}` : ''}`);
      } else {
        // Update all extensions
        if (config.extensions.length === 0) {
          console.log('No extensions installed.');
          return;
        }
        console.log('Updating all extensions...');
        for (const ext of config.extensions) {
          console.log(`  Updating ${ext.name}...`);
          await execAsync(`npm update ${ext.name}`, { cwd: extensionsDir });
          const newVersion = await readInstalledVersion(extensionsDir, ext.name);
          await addExtensionToConfig(ext.name, newVersion);
        }
        console.log('✓ All extensions updated');
      }
    });

  extension
    .command('enable')
    .description('Enable a disabled extension')
    .argument('<package>', 'npm package name')
    .action(async (packageName) => {
      const config = await loadExtensionConfig();
      const ext = config.extensions.find(e => e.name === packageName);
      if (!ext) {
        console.error(`Extension ${packageName} is not installed.`);
        process.exit(1);
      }
      if (ext.enabled !== false) {
        console.log(`Extension ${packageName} is already enabled.`);
        return;
      }
      await addExtensionToConfig(packageName, ext.version, true);
      console.log(`✓ Enabled ${packageName}`);
    });

  extension
    .command('disable')
    .description('Disable an extension without removing it')
    .argument('<package>', 'npm package name')
    .action(async (packageName) => {
      const config = await loadExtensionConfig();
      const ext = config.extensions.find(e => e.name === packageName);
      if (!ext) {
        console.error(`Extension ${packageName} is not installed.`);
        process.exit(1);
      }
      if (ext.enabled === false) {
        console.log(`Extension ${packageName} is already disabled.`);
        return;
      }
      await addExtensionToConfig(packageName, ext.version, false);
      console.log(`✓ Disabled ${packageName}`);
    });

  return extension;
}
