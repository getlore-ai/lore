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
import { registerAuthCommands } from './cli/commands/auth.js';
import { registerSkillsCommand } from './cli/commands/skills.js';
import { registerUpdateCommand } from './cli/commands/update.js';
import { registerIngestCommand } from './cli/commands/ingest.js';
import { registerBriefCommand } from './cli/commands/brief.js';
import { registerLogCommand } from './cli/commands/log.js';
import { getExtensionRegistry, getLoreVersionString } from './extensions/registry.js';
import { bridgeConfigToEnv } from './core/config.js';
import { expandPath } from './sync/config.js';
import { showWelcomeScreen } from './cli/welcome.js';

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

// Bridge config.json values into process.env (env vars take precedence)
try {
  await bridgeConfigToEnv();
} catch {
  // Config not set up yet — fine, user may be running `lore setup`
}

// Default data directory
const DEFAULT_DATA_DIR = expandPath(process.env.LORE_DATA_DIR || '~/.lore');

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
registerAskCommand(program, DEFAULT_DATA_DIR);
registerAuthCommands(program);
registerSkillsCommand(program);
registerUpdateCommand(program, DEFAULT_DATA_DIR);
registerIngestCommand(program, DEFAULT_DATA_DIR);
registerBriefCommand(program, DEFAULT_DATA_DIR);
registerLogCommand(program, DEFAULT_DATA_DIR);

// Extension system — hidden from top-level help for now
const extensionCmd = registerExtensionCommands(program);
(extensionCmd as unknown as { _hidden: boolean })._hidden = true;
registerPendingCommand(extensionCmd, DEFAULT_DATA_DIR);

try {
  const extensionRegistry = await getExtensionRegistry({
    logger: (message) => console.error(message),
  });
  extensionRegistry.registerCommands(program, {
    defaultDataDir: DEFAULT_DATA_DIR,
  });
} catch {
  // Extensions not loaded — fine for initial release
}

// Default action: show welcome screen when no command is given
program.action(() => {
  showWelcomeScreen();
});

// Global error handler — show friendly messages instead of stack traces
process.on('uncaughtException', (error) => {
  console.error(`\nError: ${error.message}`);
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  console.error(`\nError: ${message}`);
  process.exit(1);
});

// Parse and run, then show update notification after command output
await program.parseAsync();

// Passive update notification (non-blocking, silent on errors)
try {
  const { checkForUpdates } = await import('./cli/update-notifier.js');
  await checkForUpdates();
} catch {}
