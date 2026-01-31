/**
 * Documents CLI Commands
 *
 * CRUD operations for documents: list, get, create, delete
 */

import type { Command } from 'commander';
import path from 'path';

import { getSourceById } from '../../core/vector-store.js';

export function registerDocsCommand(program: Command, defaultDataDir: string): void {
  const docsCmd = program
    .command('docs')
    .description('Document operations (CRUD)');

  // List documents
  docsCmd
    .command('list')
    .description('List all documents')
    .option('-p, --project <project>', 'Filter by project')
    .option('-t, --type <type>', 'Filter by source type')
    .option('-l, --limit <limit>', 'Max results', '20')
    .option('-d, --data-dir <dir>', 'Data directory', defaultDataDir)
    .action(async (options) => {
      const { handleListSources } = await import('../../mcp/handlers/list-sources.js');
      const dataDir = options.dataDir;
      const dbPath = path.join(dataDir, 'lore.lance');

      const result = await handleListSources(dbPath, {
        project: options.project,
        source_type: options.type,
        limit: parseInt(options.limit),
      }) as { sources: Array<{ id: string; title: string; source_type: string; content_type: string; projects: string[]; created_at: string; summary: string }>; total: number };

      console.log(`\nDocuments (${result.total}):`);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

      if (result.sources.length === 0) {
        console.log('No documents found.');
        return;
      }

      for (const source of result.sources) {
        const date = new Date(source.created_at).toLocaleDateString();
        console.log(`\n📄 ${source.title}`);
        console.log(`   ID: ${source.id}`);
        console.log(`   Type: ${source.source_type} | ${source.content_type}`);
        console.log(`   Projects: ${source.projects.join(', ') || '(none)'}`);
        console.log(`   Date: ${date}`);
      }
      console.log('');
    });

  // Get document
  docsCmd
    .command('get')
    .description('Get full details of a document')
    .argument('<id>', 'Document ID')
    .option('-c, --content', 'Include full content')
    .option('-d, --data-dir <dir>', 'Data directory', defaultDataDir)
    .action(async (docId, options) => {
      const { handleGetSource } = await import('../../mcp/handlers/get-source.js');
      const dataDir = options.dataDir;
      const dbPath = path.join(dataDir, 'lore.lance');

      const result = await handleGetSource(dbPath, dataDir, {
        source_id: docId,
        include_content: options.content,
      }) as Record<string, unknown>;

      if (result.error) {
        console.error(`Error: ${result.error}`);
        process.exit(1);
      }

      console.log(`\n📄 ${result.title}`);
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      console.log(`ID: ${result.id}`);
      console.log(`Type: ${result.source_type} | ${result.content_type}`);
      console.log(`Projects: ${(result.projects as string[])?.join(', ') || '(none)'}`);
      console.log(`Tags: ${(result.tags as string[])?.join(', ') || '(none)'}`);
      console.log(`Created: ${result.created_at}`);
      console.log(`\nSummary:\n${result.summary}`);

      const themes = result.themes as Array<{ name: string }>;
      if (themes && themes.length > 0) {
        console.log(`\nThemes:`);
        for (const theme of themes) {
          console.log(`  • ${theme.name}`);
        }
      }

      const quotes = result.quotes as Array<{ speaker: string; text: string }>;
      if (quotes && quotes.length > 0) {
        console.log(`\nQuotes (${quotes.length}):`);
        for (const quote of quotes.slice(0, 5)) {
          const speaker = quote.speaker === 'user' ? '[You]' : '[Participant]';
          console.log(`  ${speaker} "${quote.text.substring(0, 100)}${quote.text.length > 100 ? '...' : ''}"`);
        }
        if (quotes.length > 5) {
          console.log(`  ... and ${quotes.length - 5} more`);
        }
      }

      if (result.full_content) {
        console.log(`\n${'─'.repeat(60)}`);
        console.log(`Full Content:\n`);
        console.log(result.full_content);
      }
      console.log('');
    });

  // Create (save a note/insight)
  docsCmd
    .command('create')
    .description('Create a note or insight')
    .argument('<content>', 'Content to save')
    .requiredOption('-p, --project <project>', 'Project this belongs to')
    .option('-t, --type <type>', 'Type: insight, decision, requirement, note', 'note')
    .option('--context <context>', 'Source context (e.g., "from interview with Sarah")')
    .option('--tags <tags>', 'Comma-separated tags')
    .option('-d, --data-dir <dir>', 'Data directory', defaultDataDir)
    .option('--no-push', 'Skip git push')
    .action(async (content, options) => {
      const { handleRetain } = await import('../../mcp/handlers/retain.js');
      const dataDir = options.dataDir;
      const dbPath = path.join(dataDir, 'lore.lance');

      const validTypes = ['insight', 'decision', 'requirement', 'note'];
      if (!validTypes.includes(options.type)) {
        console.error(`Invalid type: ${options.type}. Must be one of: ${validTypes.join(', ')}`);
        process.exit(1);
      }

      const result = await handleRetain(dbPath, dataDir, {
        content,
        project: options.project,
        type: options.type as 'insight' | 'decision' | 'requirement' | 'note',
        source_context: options.context,
        tags: options.tags?.split(',').map((t: string) => t.trim()),
      }, { autoPush: options.push !== false }) as { success: boolean; id: string; message: string; indexed: boolean; synced: boolean };

      if (result.success) {
        console.log(`\n✓ ${result.message}`);
        console.log(`  ID: ${result.id}`);
        console.log(`  Indexed: ${result.indexed ? 'yes' : 'no'}`);
        console.log(`  Synced: ${result.synced ? 'yes' : 'no'}`);
      } else {
        console.error(`\nFailed to create: ${result.message}`);
        process.exit(1);
      }
    });

  // Delete document
  docsCmd
    .command('delete')
    .description('Delete a document')
    .argument('<id>', 'Document ID')
    .option('-d, --data-dir <dir>', 'Data directory', defaultDataDir)
    .option('--force', 'Skip confirmation')
    .action(async (docId, options) => {
      const dataDir = options.dataDir;
      const dbPath = path.join(dataDir, 'lore.lance');

      // Get document info first
      const source = await getSourceById(dbPath, docId);
      if (!source) {
        console.error(`Document not found: ${docId}`);
        process.exit(1);
      }

      if (!options.force) {
        const readline = await import('readline');
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });

        const answer = await new Promise<string>((resolve) => {
          rl.question(`Delete "${source.title}"? (y/N) `, resolve);
        });
        rl.close();

        if (answer.toLowerCase() !== 'y') {
          console.log('Cancelled.');
          return;
        }
      }

      // Delete from vector store
      const { deleteSource } = await import('../../core/vector-store.js');
      await deleteSource(dbPath, docId);

      // Delete from disk
      const { rm } = await import('fs/promises');
      const sourcePath = path.join(dataDir, 'sources', docId);
      try {
        await rm(sourcePath, { recursive: true });
      } catch {
        // File may not exist on disk
      }

      console.log(`\n✓ Deleted: ${source.title}`);
    });
}
