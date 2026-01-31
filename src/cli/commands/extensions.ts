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
import { getExtensionRegistry } from '../../extensions/registry.js';
import { toolDefinitions } from '../../mcp/tools.js';
import { handleSearch } from '../../mcp/handlers/search.js';
import { handleGetSource } from '../../mcp/handlers/get-source.js';
import { handleListSources } from '../../mcp/handlers/list-sources.js';
import { handleRetain } from '../../mcp/handlers/retain.js';
import { handleIngest } from '../../mcp/handlers/ingest.js';
import { handleResearch } from '../../mcp/handlers/research.js';
import { handleListProjects } from '../../mcp/handlers/list-projects.js';
import { handleSync } from '../../mcp/handlers/sync.js';
import { handleArchiveProject } from '../../mcp/handlers/archive-project.js';
import { expandPath } from '../../sync/config.js';

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

function parseJsonValue(value: string): unknown {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return '';
  }

  const looksLikeJson =
    trimmed.startsWith('{') ||
    trimmed.startsWith('[') ||
    trimmed.startsWith('"') ||
    trimmed === 'true' ||
    trimmed === 'false' ||
    trimmed === 'null' ||
    /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(trimmed);

  if (!looksLikeJson) {
    return value;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function parseToolArgs(rawArgs: string[]): Record<string, unknown> {
  if (rawArgs.length === 0) {
    return {};
  }

  if (rawArgs.length === 1) {
    const lone = rawArgs[0].trim();
    if (lone.startsWith('{') || lone.startsWith('[')) {
      try {
        const parsed = JSON.parse(lone) as unknown;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error('Tool args JSON must be an object.');
        }
        return parsed as Record<string, unknown>;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Invalid JSON arguments.';
        throw new Error(`Failed to parse JSON args: ${message}`);
      }
    }
  }

  const args: Record<string, unknown> = {};
  for (const entry of rawArgs) {
    const eqIndex = entry.indexOf('=');
    if (eqIndex === -1) {
      throw new Error(`Invalid arg "${entry}". Use key=value or JSON.`);
    }
    const key = entry.slice(0, eqIndex).trim();
    const rawValue = entry.slice(eqIndex + 1);
    if (!key) {
      throw new Error(`Invalid arg "${entry}". Missing key.`);
    }
    args[key] = parseJsonValue(rawValue);
  }
  return args;
}

function formatToolTable(rows: Array<{ name: string; description: string; source: string }>): string {
  const headers = ['Name', 'Description', 'Source'];
  const widths = [
    headers[0].length,
    headers[1].length,
    headers[2].length,
  ];

  for (const row of rows) {
    widths[0] = Math.max(widths[0], row.name.length);
    widths[1] = Math.max(widths[1], row.description.length);
    widths[2] = Math.max(widths[2], row.source.length);
  }

  const pad = (value: string, width: number) => value.padEnd(width, ' ');
  const lines: string[] = [];
  lines.push(
    `${pad(headers[0], widths[0])}  ${pad(headers[1], widths[1])}  ${pad(headers[2], widths[2])}`
  );
  lines.push(
    `${'-'.repeat(widths[0])}  ${'-'.repeat(widths[1])}  ${'-'.repeat(widths[2])}`
  );

  for (const row of rows) {
    lines.push(
      `${pad(row.name, widths[0])}  ${pad(row.description, widths[1])}  ${pad(row.source, widths[2])}`
    );
  }

  return lines.join('\n');
}

async function callCoreTool(
  name: string,
  args: Record<string, unknown>,
  dataDir: string,
  dbPath: string
): Promise<unknown> {
  switch (name) {
    case 'search':
      return handleSearch(dbPath, dataDir, args as any);
    case 'get_source':
      return handleGetSource(dbPath, dataDir, args as any);
    case 'list_sources':
      return handleListSources(dbPath, args as any);
    case 'list_projects':
      return handleListProjects(dbPath);
    case 'retain':
      return handleRetain(dbPath, dataDir, args as any, {});
    case 'ingest':
      return handleIngest(dbPath, dataDir, args as any, {
        hookContext: { mode: 'cli' },
      });
    case 'research':
      return handleResearch(dbPath, dataDir, args as any, {
        hookContext: { mode: 'cli' },
      });
    case 'sync':
      return handleSync(dbPath, dataDir, args as any, {
        hookContext: { mode: 'cli' },
      });
    case 'archive_project':
      return handleArchiveProject(dbPath, dataDir, args as any, {});
    default:
      throw new Error(`Unknown tool: ${name}`);
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

  const tool = program
    .command('tool')
    .description('Call tools directly (core + extensions)');

  tool
    .command('list')
    .description('List available tools')
    .action(async () => {
      try {
        const extensionRegistry = await getExtensionRegistry({
          logger: (message) => console.error(message),
        });
        const coreToolNames = new Set(toolDefinitions.map((toolDef) => toolDef.name));
        const extensionTools = extensionRegistry
          .getToolDefinitions()
          .filter((toolDef) => !coreToolNames.has(toolDef.name));

        const rows = [
          ...toolDefinitions.map((toolDef) => ({
            name: toolDef.name,
            description: toolDef.description || '',
            source: 'core',
          })),
          ...extensionTools.map((toolDef) => ({
            name: toolDef.name,
            description: toolDef.description || '',
            source: extensionRegistry.getToolRoute(toolDef.name)?.extensionName || 'extension',
          })),
        ].sort((a, b) => a.name.localeCompare(b.name));

        if (rows.length === 0) {
          console.log('No tools available.');
          return;
        }

        console.log(formatToolTable(rows));
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error(`Failed to list tools: ${message}`);
        process.exit(1);
      }
    });

  tool
    .command('call')
    .description('Call a tool by name')
    .argument('<name>', 'Tool name')
    .argument('[args...]', 'Tool args as key=value or JSON')
    .action(async (name: string, rawArgs: string[]) => {
      try {
        const args = parseToolArgs(rawArgs);
        const dataDir = expandPath(process.env.LORE_DATA_DIR || './data');
        const dbPath = path.join(dataDir, 'lore.lance');
        const extensionRegistry = await getExtensionRegistry({
          logger: (message) => console.error(message),
        });
        const coreToolNames = new Set(toolDefinitions.map((toolDef) => toolDef.name));

        let result: unknown;

        if (coreToolNames.has(name)) {
          result = await callCoreTool(name, args, dataDir, dbPath);
        } else {
          const extensionResult = await extensionRegistry.handleToolCall(name, args, {
            mode: 'cli',
            dataDir,
            dbPath,
          });

          if (!extensionResult.handled) {
            throw new Error(`Unknown tool: ${name}`);
          }
          result = extensionResult.result;
        }

        console.log(JSON.stringify(result, null, 2));
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error(`Tool call failed: ${message}`);
        console.error('Examples:');
        console.error('  lore tool call search query="user feedback" project=ridekick');
        console.error('  lore tool call ridekick_pain_points project=ridekick limit=5');
        console.error('  lore tool call ridekick_hypothesis hypothesis="Users find pricing confusing"');
        console.error('  lore tool call search \'{"query":"user feedback","project":"ridekick"}\'');
        process.exit(1);
      }
    });
}
