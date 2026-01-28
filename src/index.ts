#!/usr/bin/env node

/**
 * Lore CLI
 *
 * Commands:
 * - ingest: Import sources from various formats (Granola, Claude, etc.)
 * - sync: Rebuild the vector index
 * - search: Search the knowledge base from command line
 * - mcp: Start the MCP server
 */

import { Command } from 'commander';

const program = new Command();

program
  .name('lore')
  .description('Research knowledge repository with semantic search and citations')
  .version('0.1.0');

// Ingest command - import sources
program
  .command('ingest')
  .description('Import sources into the knowledge repository')
  .argument('<path>', 'Path to source file or directory')
  .option('-t, --type <type>', 'Source type (granola, claude-code, markdown)', 'markdown')
  .option('-p, --project <project>', 'Associate with project')
  .option('--tags <tags>', 'Comma-separated tags')
  .action(async (sourcePath, options) => {
    console.log(`Ingesting ${sourcePath} as ${options.type}...`);
    console.log('TODO: Implement ingest command');
    // TODO: Implement ingestion for each source type
  });

// Sync command - rebuild index
program
  .command('sync')
  .description('Rebuild the vector index from all sources')
  .option('-d, --data-dir <dir>', 'Data directory', './data')
  .action(async (options) => {
    console.log(`Syncing index in ${options.dataDir}...`);
    console.log('TODO: Implement sync command');
    // TODO: Implement full reindexing
  });

// Search command - CLI search
program
  .command('search')
  .description('Search the knowledge repository')
  .argument('<query>', 'Search query')
  .option('-p, --project <project>', 'Filter by project')
  .option('-l, --limit <limit>', 'Max results', '10')
  .action(async (query, options) => {
    console.log(`Searching for: ${query}`);
    console.log('TODO: Implement search command');
    // TODO: Implement CLI search
  });

// MCP command - start server
program
  .command('mcp')
  .description('Start the MCP server')
  .action(async () => {
    // Dynamic import to avoid loading MCP deps for other commands
    const { default: startServer } = await import('./mcp/server.js');
  });

// Projects command
program
  .command('projects')
  .description('List all projects')
  .action(async () => {
    console.log('TODO: Implement projects list');
  });

program.parse();
