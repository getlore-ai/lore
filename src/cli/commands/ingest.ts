/**
 * Ingest Command
 *
 * Import sources into the knowledge repository from various formats.
 */

import type { Command } from 'commander';
import path from 'path';
import { mkdir } from 'fs/promises';

import { ingestGranolaExports, listGranolaExports } from '../../ingest/granola.js';
import { ingestClaudeCodeConversations, listClaudeCodeConversations } from '../../ingest/claude-code.js';
import { ingestMarkdownDirectory, listMarkdownFiles } from '../../ingest/markdown.js';
import { getAllSources, indexExists } from '../../core/vector-store.js';
import { buildIndex, saveSourcesToDisk } from '../helpers.js';

export function registerIngestCommand(program: Command, defaultDataDir: string): void {
  program
    .command('ingest')
    .description('Import sources into the knowledge repository')
    .argument('<path>', 'Path to source file or directory')
    .option('-t, --type <type>', 'Source type (granola, claude-code, markdown)', 'granola')
    .option('-p, --project <project>', 'Associate with project')
    .option('--tags <tags>', 'Comma-separated tags')
    .option('-d, --data-dir <dir>', 'Data directory', defaultDataDir)
    .option('--skip-extraction', 'Skip insight extraction (faster)')
    .option('--skip-indexing', 'Skip vector indexing (run sync later)')
    .action(async (sourcePath, options) => {
      const dataDir = options.dataDir;
      const dbPath = path.join(dataDir, 'lore.lance');
      const sourcesDir = path.join(dataDir, 'sources');

      console.log(`\nLore Ingest`);
      console.log(`===========`);
      console.log(`Source: ${sourcePath}`);
      console.log(`Type: ${options.type}`);
      console.log(`Project: ${options.project || '(none)'}`);
      console.log(`Data dir: ${dataDir}\n`);

      // Ensure directories exist
      await mkdir(sourcesDir, { recursive: true });

      if (options.type === 'granola') {
        await ingestGranola(sourcePath, options, dbPath, sourcesDir, dataDir);
      } else if (options.type === 'claude-code') {
        await ingestClaudeCode(sourcePath, options, dbPath, sourcesDir, dataDir);
      } else if (options.type === 'markdown') {
        await ingestMarkdown(sourcePath, options, dbPath, sourcesDir, dataDir);
      } else {
        console.log(`Source type "${options.type}" not yet implemented.`);
        console.log('Supported types: granola, claude-code, markdown');
        process.exit(1);
      }
    });
}

async function ingestGranola(
  sourcePath: string,
  options: Record<string, unknown>,
  dbPath: string,
  sourcesDir: string,
  dataDir: string
): Promise<void> {
  // List what we'll ingest
  const exports = await listGranolaExports(sourcePath);
  console.log(`Found ${exports.length} Granola exports\n`);

  if (exports.length === 0) {
    console.log('No exports found. Make sure the path points to a granola-extractor export directory.');
    process.exit(1);
  }

  // Check for existing sources
  const existingIds: string[] = [];
  if (await indexExists(dbPath)) {
    const existing = await getAllSources(dbPath, {});
    existingIds.push(...existing.map((s) => s.id));
  }

  const newExports = exports.filter((e) => !existingIds.includes(e.id));
  console.log(`New sources to ingest: ${newExports.length}`);
  console.log(`Already indexed: ${existingIds.length}\n`);

  if (newExports.length === 0) {
    console.log('All sources already ingested. Run with --force to re-ingest.');
    return;
  }

  // Ingest with progress
  console.log('Ingesting sources...');
  const results = await ingestGranolaExports(sourcePath, {
    project: options.project as string | undefined,
    extractInsightsEnabled: !options.skipExtraction,
    skipExisting: existingIds,
    onProgress: (current: number, total: number, title: string) => {
      process.stdout.write(`\r  [${current}/${total}] ${title.substring(0, 50).padEnd(50)}`);
    },
  });
  console.log('\n');

  // Save sources to disk
  console.log('Saving sources to disk...');
  await saveSourcesToDisk(sourcesDir, results);
  console.log(`Saved ${results.length} sources to ${sourcesDir}\n`);

  // Index if not skipped
  if (!options.skipIndexing) {
    console.log('Building vector index...');
    await buildIndex(dataDir, results);
    console.log('Done!\n');
  } else {
    console.log('Skipped indexing. Run "lore sync" to build the vector index.\n');
  }

  console.log(`\nIngested ${results.length} sources.`);
  console.log(`Run "lore search <query>" to search, or start the MCP server with "lore mcp".`);
}

async function ingestClaudeCode(
  sourcePath: string,
  options: Record<string, unknown>,
  dbPath: string,
  sourcesDir: string,
  dataDir: string
): Promise<void> {
  // List what we'll ingest
  const conversations = await listClaudeCodeConversations(sourcePath);
  console.log(`Found ${conversations.length} Claude Code conversations\n`);

  if (conversations.length === 0) {
    console.log('No conversations found. Make sure the path points to ~/.claude/projects or similar.');
    process.exit(1);
  }

  // Check for existing sources
  const existingIds: string[] = [];
  if (await indexExists(dbPath)) {
    const existing = await getAllSources(dbPath, {});
    existingIds.push(...existing.map((s) => s.id));
  }

  const newConversations = conversations.filter((c) => !existingIds.includes(c.id));
  console.log(`New conversations to ingest: ${newConversations.length}`);
  console.log(`Already indexed: ${existingIds.length}\n`);

  if (newConversations.length === 0) {
    console.log('All conversations already ingested.');
    return;
  }

  // Ingest with progress
  console.log('Ingesting conversations...');
  const results = await ingestClaudeCodeConversations(sourcePath, {
    project: options.project as string | undefined,
    extractInsightsEnabled: !options.skipExtraction,
    skipExisting: existingIds,
    onProgress: (current: number, total: number, title: string) => {
      process.stdout.write(`\r  [${current}/${total}] ${title.substring(0, 50).padEnd(50)}`);
    },
  });
  console.log('\n');

  // Save sources to disk
  console.log('Saving sources to disk...');
  await saveSourcesToDisk(sourcesDir, results);
  console.log(`Saved ${results.length} sources to ${sourcesDir}\n`);

  // Index if not skipped
  if (!options.skipIndexing) {
    console.log('Building vector index...');
    await buildIndex(dataDir, results.map((r) => ({
      source: r.source,
      notes: '',
      transcript: '',
      insights: r.insights,
    })));
    console.log('Done!\n');
  } else {
    console.log('Skipped indexing. Run "lore sync" to build the vector index.\n');
  }

  console.log(`\nIngested ${results.length} conversations.`);
  console.log(`Run "lore search <query>" to search, or start the MCP server with "lore mcp".`);
}

async function ingestMarkdown(
  sourcePath: string,
  options: Record<string, unknown>,
  dbPath: string,
  sourcesDir: string,
  dataDir: string
): Promise<void> {
  // List what we'll ingest
  const files = await listMarkdownFiles(sourcePath);
  console.log(`Found ${files.length} markdown files\n`);

  if (files.length === 0) {
    console.log('No markdown files found in the specified directory.');
    process.exit(1);
  }

  // Check for existing sources
  const existingIds: string[] = [];
  if (await indexExists(dbPath)) {
    const existing = await getAllSources(dbPath, {});
    existingIds.push(...existing.map((s) => s.id));
  }

  console.log(`Already indexed: ${existingIds.length}\n`);

  // Ingest with progress
  console.log('Ingesting markdown files...');
  const tagsStr = options.tags as string | undefined;
  const results = await ingestMarkdownDirectory(sourcePath, {
    project: options.project as string | undefined,
    tags: tagsStr?.split(',').map((t: string) => t.trim()),
    extractInsightsEnabled: !options.skipExtraction,
    skipExisting: existingIds,
    onProgress: (current: number, total: number, title: string) => {
      process.stdout.write(`\r  [${current}/${total}] ${title.substring(0, 50).padEnd(50)}`);
    },
  });
  console.log('\n');

  // Save sources to disk
  console.log('Saving sources to disk...');
  await saveSourcesToDisk(sourcesDir, results);
  console.log(`Saved ${results.length} sources to ${sourcesDir}\n`);

  // Index if not skipped
  if (!options.skipIndexing) {
    console.log('Building vector index...');
    await buildIndex(dataDir, results.map((r) => ({
      source: r.source,
      notes: '',
      transcript: '',
      insights: r.insights,
    })));
    console.log('Done!\n');
  } else {
    console.log('Skipped indexing. Run "lore sync" to build the vector index.\n');
  }

  console.log(`\nIngested ${results.length} markdown files.`);
  console.log(`Run "lore search <query>" to search, or start the MCP server with "lore mcp".`);
}
