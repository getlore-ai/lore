#!/usr/bin/env node

/**
 * Lore CLI
 *
 * Research knowledge repository with semantic search and citations.
 *
 * Commands:
 * - sync: Sync and manage the knowledge repository (daemon, watch, sources, import)
 * - search: Search the knowledge base
 * - research: Deep AI-powered research
 * - browse: Interactive TUI browser
 * - docs: Document CRUD (list, get, create, delete)
 * - projects: Project management (list, archive, delete)
 * - init: Initialize a data repository
 * - serve: Start the MCP server
 */

// Load environment variables from .env files
// .env.local takes precedence over .env
import { existsSync, readFileSync } from 'fs';
import { parse } from 'dotenv';
import { Command } from 'commander';

import { registerSyncCommand } from './cli/commands/sync.js';
import { registerSearchCommand } from './cli/commands/search.js';
import { registerMiscCommands } from './cli/commands/misc.js';
import { registerDocsCommand } from './cli/commands/docs.js';
import { registerProjectsCommand } from './cli/commands/projects.js';
import { registerExtensionCommands } from './cli/commands/extensions.js';
import { registerPendingCommand } from './cli/commands/pending.js';
import { registerAskCommand } from './cli/commands/ask.js';
import { getExtensionRegistry, getLoreVersionString } from './extensions/registry.js';

// Load .env files silently (without the v17 logging)
function loadEnvFile(filePath: string, override = false): void {
  if (!existsSync(filePath)) return;
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

// Default data directory
const DEFAULT_DATA_DIR = process.env.LORE_DATA_DIR || './data';

// Create program
const program = new Command();

program
  .name('lore')
  .description('Research knowledge repository with semantic search and citations')
  .version((await getLoreVersionString()) || '0.1.0');

// Register all commands
registerSyncCommand(program, DEFAULT_DATA_DIR);
registerSearchCommand(program, DEFAULT_DATA_DIR);
registerDocsCommand(program, DEFAULT_DATA_DIR);
registerProjectsCommand(program, DEFAULT_DATA_DIR);
registerMiscCommands(program, DEFAULT_DATA_DIR);
registerExtensionCommands(program);
registerPendingCommand(program, DEFAULT_DATA_DIR);
registerAskCommand(program, DEFAULT_DATA_DIR);

// Load extension registry and register extension commands
try {
  const extensionRegistry = await getExtensionRegistry({
    logger: (message) => console.error(message),
  });
  extensionRegistry.registerCommands(program, {
    defaultDataDir: DEFAULT_DATA_DIR,
  });
} catch (error) {
  console.error('[extensions] Failed to load extensions:', error);
}

// Parse and run
program.parse();
