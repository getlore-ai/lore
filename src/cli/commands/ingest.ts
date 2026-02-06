/**
 * Ingest Command
 *
 * Push content directly into Lore from the CLI.
 * Accepts inline text, a file path, or piped stdin.
 */

import type { Command } from 'commander';
import { readFileSync, existsSync } from 'fs';
import path from 'path';

export function registerIngestCommand(program: Command, defaultDataDir: string): void {
  program
    .command('ingest')
    .description('Ingest content into the knowledge base')
    .argument('[content]', 'Content to ingest (or use --file / stdin)')
    .option('-f, --file <path>', 'Read content from a file')
    .option('-t, --title <title>', 'Document title')
    .option('-p, --project <project>', 'Project name', 'default')
    .option('--type <type>', 'Source type (e.g. meeting, notes, article)')
    .option('--url <url>', 'Source URL for citation linking')
    .option('--name <name>', 'Human-readable source name')
    .option('--tags <tags>', 'Comma-separated tags')
    .option('-d, --data-dir <dir>', 'Data directory', defaultDataDir)
    .action(async (contentArg, options) => {
      const { handleIngest } = await import('../../mcp/handlers/ingest.js');

      const dataDir = options.dataDir;
      const dbPath = path.join(dataDir, 'lore.lance');

      // Resolve content from argument, file, or stdin
      let content: string;

      if (options.file) {
        const filePath = options.file.replace(/^~/, process.env.HOME || '~');
        if (!existsSync(filePath)) {
          console.error(`File not found: ${filePath}`);
          process.exit(1);
        }
        content = readFileSync(filePath, 'utf-8');
      } else if (contentArg) {
        content = contentArg;
      } else if (!process.stdin.isTTY) {
        // Reading from pipe/stdin
        content = readFileSync(0, 'utf-8');
      } else {
        console.error('No content provided. Use one of:');
        console.error('  lore ingest "Your content here"');
        console.error('  lore ingest --file ./notes.md');
        console.error('  echo "content" | lore ingest');
        process.exit(1);
      }

      content = content.trim();
      if (!content) {
        console.error('Content is empty.');
        process.exit(1);
      }

      // Derive title from file name or content
      let title = options.title;
      if (!title && options.file) {
        title = path.basename(options.file, path.extname(options.file));
      }
      if (!title) {
        // Use first line or first 60 chars
        const firstLine = content.split('\n')[0].replace(/^#+\s*/, '');
        title = firstLine.length > 60 ? firstLine.slice(0, 57) + '...' : firstLine;
      }

      const tags = options.tags ? options.tags.split(',').map((t: string) => t.trim()) : [];

      console.log(`\nIngesting: ${title}`);
      console.log(`Project:   ${options.project}`);
      if (options.type) console.log(`Type:      ${options.type}`);
      console.log(`Content:   ${content.length} chars`);
      console.log('');

      const result = await handleIngest(dbPath, dataDir, {
        content,
        title,
        project: options.project,
        source_type: options.type,
        tags,
        source_url: options.url,
        source_name: options.name,
      }, {
        hookContext: { mode: 'cli' },
      }) as Record<string, unknown>;

      if (result.deduplicated) {
        console.log('Already exists (identical content). Skipped.');
        return;
      }

      if (result.success) {
        console.log(`Ingested (ID: ${result.id})`);
        if (result.indexed) {
          console.log('Indexed and searchable.');
        } else {
          console.log('Saved to disk. Run "lore sync" to index.');
        }
        if (result.synced) {
          console.log('Pushed to git.');
        }
      } else {
        console.error('Ingestion failed.');
        process.exit(1);
      }
    });
}
