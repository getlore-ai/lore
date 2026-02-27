/**
 * Log CLI Commands
 *
 * View, delete, and update log entries for a project.
 * Log entries are lightweight notes created via the `log` MCP tool
 * or `lore ingest --type log`.
 */

import type { Command } from 'commander';
import path from 'path';

export function registerLogCommand(program: Command, defaultDataDir: string): void {
  const logCmd = program
    .command('log')
    .description('Project log — progress updates, decisions, and status notes');

  // View log (default action): `lore log <project>`
  logCmd
    .command('show', { isDefault: true })
    .description('View the project log')
    .argument('<project>', 'Project to show log entries for')
    .option('-l, --limit <number>', 'Max entries to show', '50')
    .option('--json', 'Output as JSON')
    .option('-d, --data-dir <dir>', 'Data directory', defaultDataDir)
    .action(async (project, options) => {
      const { getAllSources } = await import('../../core/vector-store.js');

      const dbPath = path.join(options.dataDir, 'lore.lance');
      const limit = parseInt(options.limit, 10) || 50;

      const sources = await getAllSources(dbPath, {
        project: project.toLowerCase().trim(),
        source_type: 'log',
        sort_by: 'created_at',
        limit,
      });

      if (options.json) {
        console.log(JSON.stringify(sources, null, 2));
        return;
      }

      if (sources.length === 0) {
        console.log(`No log entries found for project "${project}".`);
        console.log('Use the `log` MCP tool or `lore ingest --type log` to add entries.');
        return;
      }

      const countLabel = sources.length >= limit
        ? `last ${sources.length} entries`
        : `${sources.length} entries`;
      console.log(`\nProject Log: ${project} (${countLabel})`);
      console.log('\u2501'.repeat(50));

      // Show in chronological order (oldest first)
      const chronological = [...sources].reverse();
      for (const source of chronological) {
        const date = new Date(source.created_at);
        const formatted = date.toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
        });
        const time = date.toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
        });

        const message = (source.summary ?? '').replace(/\n/g, ' ').trim();
        const shortId = source.id.slice(0, 8);
        console.log(`  ${formatted}, ${time}  ${message}  \x1b[2m(${shortId})\x1b[0m`);
      }

      console.log('');
    });

  // Delete a log entry: `lore log delete <id>`
  logCmd
    .command('delete')
    .description('Delete a log entry by ID')
    .argument('<id>', 'Source ID or prefix (min 8 chars)')
    .option('-d, --data-dir <dir>', 'Data directory', defaultDataDir)
    .action(async (id, options) => {
      const { deleteSource, getSourceById, resolveSourceId } = await import('../../core/vector-store.js');
      const { resolveSourceDir, removeFromPathIndex } = await import('../../core/source-paths.js');
      const { addToBlocklist } = await import('../../core/blocklist.js');
      const { rm } = await import('fs/promises');

      const dbPath = path.join(options.dataDir, 'lore.lance');

      const resolvedId = await resolveSourceId(dbPath, id);
      if (!resolvedId) {
        console.error(`Source not found: ${id}`);
        process.exit(1);
      }

      const source = await getSourceById(dbPath, resolvedId);
      if (!source) {
        console.error(`Source not found: ${resolvedId}`);
        process.exit(1);
      }

      if (source.source_type !== 'log') {
        console.error(`Source ${resolvedId} is not a log entry (type: ${source.source_type}). Use "lore docs delete" instead.`);
        process.exit(1);
      }

      const result = await deleteSource(dbPath, resolvedId);
      if (!result.deleted) {
        console.error('Failed to delete.');
        process.exit(1);
      }

      // Clean up disk + blocklist
      try {
        const loreSourcePath = await resolveSourceDir(options.dataDir, resolvedId);
        await rm(loreSourcePath, { recursive: true });
      } catch { /* may not exist */ }
      try {
        await removeFromPathIndex(options.dataDir, resolvedId);
      } catch { /* best-effort */ }
      if (result.contentHash) {
        await addToBlocklist(options.dataDir, result.contentHash);
      }

      console.log(`Deleted: ${(source.summary ?? '').slice(0, 80)}`);
    });

  // Clear all log entries for a project: `lore log clear <project>`
  logCmd
    .command('clear')
    .description('Delete all log entries for a project')
    .argument('<project>', 'Project name')
    .option('--force', 'Skip confirmation prompt')
    .option('-d, --data-dir <dir>', 'Data directory', defaultDataDir)
    .action(async (project, options) => {
      const { getAllSources, deleteSource } = await import('../../core/vector-store.js');
      const { resolveSourceDir, removeFromPathIndex } = await import('../../core/source-paths.js');
      const { addToBlocklist } = await import('../../core/blocklist.js');
      const { rm } = await import('fs/promises');
      const readline = await import('readline');

      const dbPath = path.join(options.dataDir, 'lore.lance');
      const normalizedProject = project.toLowerCase().trim();

      const sources = await getAllSources(dbPath, {
        project: normalizedProject,
        source_type: 'log',
        limit: 10000,
      });

      if (sources.length === 0) {
        console.log(`No log entries found for project "${project}".`);
        return;
      }

      if (!options.force) {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        const answer = await new Promise<string>((resolve) => {
          rl.question(`Delete all ${sources.length} log entries for "${project}"? Type "yes" to confirm: `, resolve);
        });
        rl.close();
        if (answer.toLowerCase() !== 'yes') {
          console.log('Cancelled.');
          return;
        }
      }

      console.log(`Deleting ${sources.length} log entries for "${project}"...`);
      let deleted = 0;
      const hashes: (string | undefined)[] = [];
      for (const source of sources) {
        const result = await deleteSource(dbPath, source.id);
        if (result.deleted) {
          deleted++;
          hashes.push(result.contentHash);
          try {
            const loreSourcePath = await resolveSourceDir(options.dataDir, source.id);
            await rm(loreSourcePath, { recursive: true });
          } catch { /* may not exist */ }
          await removeFromPathIndex(options.dataDir, source.id);
        }
      }

      await addToBlocklist(options.dataDir, ...hashes);
      console.log(`Deleted ${deleted}/${sources.length} entries.`);
    });

  // Update a log entry: `lore log update <id> <message>`
  logCmd
    .command('update')
    .description('Update the content of a log entry (preserves original timestamp)')
    .argument('<id>', 'Source ID or prefix (min 8 chars)')
    .argument('<message>', 'New message content')
    .option('-d, --data-dir <dir>', 'Data directory', defaultDataDir)
    .action(async (id, message, options) => {
      const { getSourceById, updateSourceContent, updateSourceTitle, resolveSourceId } = await import('../../core/vector-store.js');
      const { generateEmbedding, createSearchableText } = await import('../../core/embedder.js');

      const dbPath = path.join(options.dataDir, 'lore.lance');

      const resolvedId = await resolveSourceId(dbPath, id);
      if (!resolvedId) {
        console.error(`Source not found: ${id}`);
        process.exit(1);
      }

      const source = await getSourceById(dbPath, resolvedId);
      if (!source) {
        console.error(`Source not found: ${resolvedId}`);
        process.exit(1);
      }

      if (source.source_type !== 'log') {
        console.error(`Source ${resolvedId} is not a log entry (type: ${source.source_type}).`);
        process.exit(1);
      }

      // Re-embed with new content
      const project = source.projects[0] || undefined;
      const searchableText = createSearchableText({
        type: 'summary',
        text: message,
        project,
      });
      const embedding = await generateEmbedding(searchableText);

      // Update content + embedding (preserves created_at)
      const contentOk = await updateSourceContent(dbPath, resolvedId, message, embedding);
      if (!contentOk) {
        console.error('Failed to update content.');
        process.exit(1);
      }

      // Update title to match new content
      const newTitle = `Log: ${message.slice(0, 50)}${message.length > 50 ? '...' : ''}`;
      await updateSourceTitle(dbPath, resolvedId, newTitle);

      console.log(`Updated: ${message.slice(0, 80)}`);
    });
}
