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
import path from 'path';
import { mkdir, writeFile, readFile } from 'fs/promises';
import { existsSync } from 'fs';

import { ingestGranolaExports, listGranolaExports } from './ingest/granola.js';
import { ingestClaudeCodeConversations, listClaudeCodeConversations } from './ingest/claude-code.js';
import { ingestMarkdownDirectory, listMarkdownFiles } from './ingest/markdown.js';
import {
  initializeTables,
  storeSources,
  searchSources,
  getAllSources,
  indexExists,
} from './core/vector-store.js';
import { generateEmbedding, generateEmbeddings, createSearchableText } from './core/embedder.js';
import type { SourceDocument, SourceRecord, Quote, Theme } from './core/types.js';

const program = new Command();

// Default data directory
const DEFAULT_DATA_DIR = process.env.LORE_DATA_DIR || './data';

program
  .name('lore')
  .description('Research knowledge repository with semantic search and citations')
  .version('0.1.0');

// ============================================================================
// Ingest Command
// ============================================================================

program
  .command('ingest')
  .description('Import sources into the knowledge repository')
  .argument('<path>', 'Path to source file or directory')
  .option('-t, --type <type>', 'Source type (granola, claude-code, markdown)', 'granola')
  .option('-p, --project <project>', 'Associate with project')
  .option('--tags <tags>', 'Comma-separated tags')
  .option('-d, --data-dir <dir>', 'Data directory', DEFAULT_DATA_DIR)
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
        project: options.project,
        extractInsightsEnabled: !options.skipExtraction,
        skipExisting: existingIds,
        onProgress: (current, total, title) => {
          process.stdout.write(`\r  [${current}/${total}] ${title.substring(0, 50).padEnd(50)}`);
        },
      });
      console.log('\n');

      // Save sources to disk
      console.log('Saving sources to disk...');
      for (const result of results) {
        const sourceDir = path.join(sourcesDir, result.source.id);
        await mkdir(sourceDir, { recursive: true });

        // Save content
        await writeFile(path.join(sourceDir, 'content.md'), result.source.content);

        // Save metadata
        const metadata = {
          id: result.source.id,
          title: result.source.title,
          source_type: result.source.source_type,
          content_type: result.source.content_type,
          created_at: result.source.created_at,
          imported_at: result.source.imported_at,
          projects: result.source.projects,
          tags: result.source.tags,
          source_path: result.source.source_path,
        };
        await writeFile(path.join(sourceDir, 'metadata.json'), JSON.stringify(metadata, null, 2));

        // Save insights if extracted
        if (result.insights) {
          await writeFile(path.join(sourceDir, 'insights.json'), JSON.stringify(result.insights, null, 2));
        }
      }
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
    } else if (options.type === 'claude-code') {
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
        project: options.project,
        extractInsightsEnabled: !options.skipExtraction,
        skipExisting: existingIds,
        onProgress: (current, total, title) => {
          process.stdout.write(`\r  [${current}/${total}] ${title.substring(0, 50).padEnd(50)}`);
        },
      });
      console.log('\n');

      // Save sources to disk
      console.log('Saving sources to disk...');
      for (const result of results) {
        const sourceDir = path.join(sourcesDir, result.source.id);
        await mkdir(sourceDir, { recursive: true });

        // Save content
        await writeFile(path.join(sourceDir, 'content.md'), result.source.content);

        // Save metadata
        const metadata = {
          id: result.source.id,
          title: result.source.title,
          source_type: result.source.source_type,
          content_type: result.source.content_type,
          created_at: result.source.created_at,
          imported_at: result.source.imported_at,
          projects: result.source.projects,
          tags: result.source.tags,
          source_path: result.source.source_path,
        };
        await writeFile(path.join(sourceDir, 'metadata.json'), JSON.stringify(metadata, null, 2));

        // Save insights if extracted
        if (result.insights) {
          await writeFile(path.join(sourceDir, 'insights.json'), JSON.stringify(result.insights, null, 2));
        }
      }
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
    } else if (options.type === 'markdown') {
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
      const results = await ingestMarkdownDirectory(sourcePath, {
        project: options.project,
        tags: options.tags?.split(',').map((t: string) => t.trim()),
        extractInsightsEnabled: !options.skipExtraction,
        skipExisting: existingIds,
        onProgress: (current, total, title) => {
          process.stdout.write(`\r  [${current}/${total}] ${title.substring(0, 50).padEnd(50)}`);
        },
      });
      console.log('\n');

      // Save sources to disk
      console.log('Saving sources to disk...');
      for (const result of results) {
        const sourceDir = path.join(sourcesDir, result.source.id);
        await mkdir(sourceDir, { recursive: true });

        // Save content
        await writeFile(path.join(sourceDir, 'content.md'), result.source.content);

        // Save metadata
        const metadata = {
          id: result.source.id,
          title: result.source.title,
          source_type: result.source.source_type,
          content_type: result.source.content_type,
          created_at: result.source.created_at,
          imported_at: result.source.imported_at,
          projects: result.source.projects,
          tags: result.source.tags,
          source_path: result.source.source_path,
        };
        await writeFile(path.join(sourceDir, 'metadata.json'), JSON.stringify(metadata, null, 2));

        // Save insights if extracted
        if (result.insights) {
          await writeFile(path.join(sourceDir, 'insights.json'), JSON.stringify(result.insights, null, 2));
        }
      }
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
    } else {
      console.log(`Source type "${options.type}" not yet implemented.`);
      console.log('Supported types: granola, claude-code, markdown');
      process.exit(1);
    }
  });

// ============================================================================
// Sync Command
// ============================================================================

program
  .command('sync')
  .description('Rebuild the vector index from all sources')
  .option('-d, --data-dir <dir>', 'Data directory', DEFAULT_DATA_DIR)
  .option('--full', 'Full reindex (ignore cache)')
  .action(async (options) => {
    const dataDir = options.dataDir;
    const sourcesDir = path.join(dataDir, 'sources');

    console.log(`\nLore Sync`);
    console.log(`=========`);
    console.log(`Data dir: ${dataDir}\n`);

    if (!existsSync(sourcesDir)) {
      console.log('No sources directory found. Run "lore ingest" first.');
      process.exit(1);
    }

    // Load all sources from disk
    console.log('Loading sources from disk...');
    const { readdirSync } = await import('fs');
    const sourceDirs = readdirSync(sourcesDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);

    const sources: Array<{
      source: SourceDocument;
      insights: { summary: string; themes: Theme[]; quotes: Quote[] };
    }> = [];

    for (const sourceId of sourceDirs) {
      const sourceDir = path.join(sourcesDir, sourceId);

      try {
        const metadata = JSON.parse(await readFile(path.join(sourceDir, 'metadata.json'), 'utf-8'));
        const content = await readFile(path.join(sourceDir, 'content.md'), 'utf-8');

        let insights = { summary: '', themes: [] as Theme[], quotes: [] as Quote[] };
        try {
          insights = JSON.parse(await readFile(path.join(sourceDir, 'insights.json'), 'utf-8'));
        } catch {
          // No insights file
        }

        sources.push({
          source: {
            ...metadata,
            content,
          },
          insights,
        });
      } catch (error) {
        console.error(`Error loading source ${sourceId}:`, error);
      }
    }

    console.log(`Loaded ${sources.length} sources\n`);

    if (sources.length === 0) {
      console.log('No sources to index.');
      return;
    }

    // Build index
    console.log('Building vector index...');
    await buildIndex(dataDir, sources.map((s) => ({
      source: s.source,
      notes: '',
      transcript: '',
      insights: s.insights,
    })));

    console.log('\nSync complete!');
  });

// ============================================================================
// Search Command
// ============================================================================

program
  .command('search')
  .description('Search the knowledge repository')
  .argument('<query>', 'Search query')
  .option('-p, --project <project>', 'Filter by project')
  .option('-l, --limit <limit>', 'Max results', '5')
  .option('-d, --data-dir <dir>', 'Data directory', DEFAULT_DATA_DIR)
  .action(async (query, options) => {
    const dataDir = options.dataDir;
    const dbPath = path.join(dataDir, 'lore.lance');

    if (!(await indexExists(dbPath))) {
      console.log('No index found. Run "lore ingest" first.');
      process.exit(1);
    }

    console.log(`\nSearching for: "${query}"\n`);

    const queryVector = await generateEmbedding(query);
    const results = await searchSources(dbPath, queryVector, {
      limit: parseInt(options.limit),
      project: options.project,
    });

    if (results.length === 0) {
      console.log('No results found.');
      return;
    }

    for (const result of results) {
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      console.log(`📄 ${result.title}`);
      console.log(`   Type: ${result.source_type} | ${result.content_type}`);
      console.log(`   Projects: ${result.projects.join(', ') || '(none)'}`);
      console.log(`   Score: ${(result.score * 100).toFixed(1)}%`);
      console.log(`\n   ${result.summary}\n`);

      if (result.quotes.length > 0) {
        console.log(`   Key Quotes:`);
        for (const quote of result.quotes.slice(0, 3)) {
          const speaker = quote.speaker === 'user' ? '[You]' : '[Participant]';
          console.log(`   • ${speaker} "${quote.text.substring(0, 100)}..."`);
        }
      }
      console.log('');
    }
  });

// ============================================================================
// Projects Command
// ============================================================================

program
  .command('projects')
  .description('List all projects')
  .option('-d, --data-dir <dir>', 'Data directory', DEFAULT_DATA_DIR)
  .action(async (options) => {
    const dataDir = options.dataDir;
    const dbPath = path.join(dataDir, 'lore.lance');

    if (!(await indexExists(dbPath))) {
      console.log('No index found. Run "lore ingest" first.');
      process.exit(1);
    }

    const { getProjectStats } = await import('./core/vector-store.js');
    const projects = await getProjectStats(dbPath);

    console.log(`\nProjects (${projects.length}):`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    for (const p of projects) {
      console.log(`\n📁 ${p.project}`);
      console.log(`   Sources: ${p.source_count} | Quotes: ${p.quote_count}`);
      console.log(`   Latest: ${new Date(p.latest_activity).toLocaleDateString()}`);
    }
    console.log('');
  });

// ============================================================================
// Init Command - Set up data repository
// ============================================================================

program
  .command('init')
  .description('Initialize a new Lore data repository')
  .argument('[path]', 'Path for the data repository', '~/lore-data')
  .option('--remote <url>', 'Git remote URL for cross-machine sync')
  .action(async (targetPath, options) => {
    const { execSync } = await import('child_process');

    // Expand ~ to home directory
    const expandedPath = targetPath.replace(/^~/, process.env.HOME || '~');

    console.log(`\nLore Init`);
    console.log(`=========`);
    console.log(`Creating data repository at: ${expandedPath}\n`);

    // Create directory structure
    await mkdir(expandedPath, { recursive: true });
    await mkdir(path.join(expandedPath, 'sources'), { recursive: true });
    await mkdir(path.join(expandedPath, 'retained'), { recursive: true });

    // Create .gitignore
    const gitignore = `# Environment files
.env
.env.local
`;
    await writeFile(path.join(expandedPath, '.gitignore'), gitignore);

    // Create README
    const readme = `# Lore Data Repository

Your personal knowledge repository for Lore.

## Structure

- \`sources/\` - Ingested documents
- \`retained/\` - Explicitly saved insights

Vector embeddings are stored in Supabase (cloud) for multi-machine access.

## Usage

Set \`LORE_DATA_DIR=${expandedPath}\` in your environment or MCP config.
`;
    await writeFile(path.join(expandedPath, 'README.md'), readme);

    console.log('✓ Created directory structure');

    // Initialize git
    try {
      execSync('git init', { cwd: expandedPath, stdio: 'pipe' });
      console.log('✓ Initialized git repository');

      // Add and commit
      execSync('git add .', { cwd: expandedPath, stdio: 'pipe' });
      execSync('git commit -m "Initial lore data repository"', { cwd: expandedPath, stdio: 'pipe' });
      console.log('✓ Created initial commit');

      // Add remote if provided
      if (options.remote) {
        execSync(`git remote add origin ${options.remote}`, { cwd: expandedPath, stdio: 'pipe' });
        console.log(`✓ Added remote: ${options.remote}`);

        try {
          execSync('git push -u origin main', { cwd: expandedPath, stdio: 'pipe' });
          console.log('✓ Pushed to remote');
        } catch {
          console.log('⚠ Could not push to remote (you may need to push manually)');
        }
      }
    } catch (error) {
      console.log('⚠ Git initialization failed (git may not be installed)');
    }

    console.log(`
Done! To use this data repository:

1. Set the environment variable:
   export LORE_DATA_DIR=${expandedPath}

2. Or add to your MCP config:
   "env": { "LORE_DATA_DIR": "${expandedPath}" }

3. Ingest some sources:
   lore ingest /path/to/docs --type markdown -p my-project
`);
  });

// ============================================================================
// MCP Command
// ============================================================================

program
  .command('mcp')
  .description('Start the MCP server')
  .action(async () => {
    // Dynamic import to start MCP server
    await import('./mcp/server.js');
  });

// ============================================================================
// Helper Functions
// ============================================================================

async function buildIndex(
  dataDir: string,
  results: Array<{
    source: SourceDocument;
    notes: string;
    transcript: string;
    insights?: { summary: string; themes: Theme[]; quotes: Quote[] };
  }>
): Promise<void> {
  const dbPath = path.join(dataDir, 'lore.lance');

  // Initialize tables
  await initializeTables(dbPath);

  // Prepare source records
  const sourceRecords: Array<{ source: SourceRecord; vector: number[] }> = [];

  // Collect all texts for batch embedding (source summaries only)
  const textsToEmbed: { id: string; text: string }[] = [];

  for (const result of results) {
    const { source, insights } = result;
    const summary = insights?.summary || source.content.substring(0, 500);

    // Add summary for source embedding
    textsToEmbed.push({
      id: `source_${source.id}`,
      text: createSearchableText({ type: 'summary', text: summary, project: source.projects[0] }),
    });
  }

  // Generate embeddings in batch
  console.log(`  Generating ${textsToEmbed.length} embeddings...`);
  const embeddings = await generateEmbeddings(
    textsToEmbed.map((t) => t.text),
    undefined,
    {
      onProgress: (completed, total) => {
        process.stdout.write(`\r  Embeddings: ${completed}/${total}`);
      },
    }
  );
  console.log('');

  // Map embeddings back
  const embeddingMap = new Map<string, number[]>();
  for (let i = 0; i < textsToEmbed.length; i++) {
    embeddingMap.set(textsToEmbed[i].id, embeddings[i]);
  }

  // Build records
  for (const result of results) {
    const { source, insights } = result;
    const summary = insights?.summary || source.content.substring(0, 500);
    const themes = insights?.themes || [];

    // Source record
    sourceRecords.push({
      source: {
        id: source.id,
        title: source.title,
        source_type: source.source_type,
        content_type: source.content_type,
        projects: JSON.stringify(source.projects),
        tags: JSON.stringify(source.tags),
        created_at: source.created_at,
        summary,
        themes_json: JSON.stringify(themes),
        quotes_json: JSON.stringify([]),
        has_full_content: true,
        vector: [],
      },
      vector: embeddingMap.get(`source_${source.id}`) || [],
    });
  }

  // Store in database
  console.log(`  Storing ${sourceRecords.length} sources...`);
  await storeSources(dbPath, sourceRecords);
}

program.parse();
