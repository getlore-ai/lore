/**
 * Log Handler - Create, update, and delete log entries
 *
 * Single MCP tool with action parameter: add (default), update, delete.
 * Log entries are lightweight sources (source_type: 'log') for
 * decisions, status notes, and progress updates.
 */

import { handleIngest } from './ingest.js';
import {
  getSourceById,
  deleteSource,
  updateSourceContent,
  updateSourceTitle,
} from '../../core/vector-store.js';
import { generateEmbedding, createSearchableText } from '../../core/embedder.js';

interface LogArgs {
  action?: 'add' | 'update' | 'delete';
  message?: string;
  project?: string;
  id?: string;
}

export async function handleLog(
  dbPath: string,
  dataDir: string,
  args: LogArgs
): Promise<unknown> {
  const action: string = args.action || 'add';

  switch (action) {
    case 'add':
      return handleLogAdd(dbPath, dataDir, args);
    case 'update':
      return handleLogUpdate(dbPath, dataDir, args);
    case 'delete':
      return handleLogDelete(dbPath, dataDir, args);
    default:
      throw new Error(`Unknown log action: ${action}. Use add, update, or delete.`);
  }
}

async function handleLogAdd(
  dbPath: string,
  dataDir: string,
  args: LogArgs
): Promise<unknown> {
  if (!args.message) throw new Error('message is required for log add');
  if (!args.project) throw new Error('project is required for log add');

  return handleIngest(dbPath, dataDir, {
    content: args.message,
    project: args.project,
    source_type: 'log',
  }, { autoPush: false, hookContext: { mode: 'mcp' } });
}

async function handleLogUpdate(
  dbPath: string,
  dataDir: string,
  args: LogArgs
): Promise<unknown> {
  if (!args.id) throw new Error('id is required for log update');
  if (!args.message) throw new Error('message is required for log update');

  const source = await getSourceById(dbPath, args.id);
  if (!source) throw new Error(`Log entry not found: ${args.id}`);
  if (source.source_type !== 'log') {
    throw new Error(`Source ${args.id} is not a log entry (type: ${source.source_type}).`);
  }

  const project = source.projects[0] || undefined;
  const searchableText = createSearchableText({
    type: 'summary',
    text: args.message,
    project,
  });
  const embedding = await generateEmbedding(searchableText);

  const contentOk = await updateSourceContent(dbPath, args.id, args.message, embedding);
  if (!contentOk) throw new Error('Failed to update log entry content.');

  const newTitle = `Log: ${args.message.slice(0, 50)}${args.message.length > 50 ? '...' : ''}`;
  await updateSourceTitle(dbPath, args.id, newTitle);

  return {
    success: true,
    id: args.id,
    message: args.message,
    project,
    created_at: source.created_at,
  };
}

async function handleLogDelete(
  dbPath: string,
  dataDir: string,
  args: LogArgs
): Promise<unknown> {
  if (!args.id) throw new Error('id is required for log delete');

  const source = await getSourceById(dbPath, args.id);
  if (!source) throw new Error(`Log entry not found: ${args.id}`);
  if (source.source_type !== 'log') {
    throw new Error(`Source ${args.id} is not a log entry (type: ${source.source_type}).`);
  }

  const result = await deleteSource(dbPath, args.id);
  if (!result.deleted) throw new Error('Failed to delete log entry.');

  // Disk files are kept intact for restore (soft delete)

  // Add to blocklist so sync won't re-ingest
  if (result.contentHash) {
    const { addToBlocklist } = await import('../../core/blocklist.js');
    await addToBlocklist(dataDir, result.contentHash);
  }

  return {
    success: true,
    id: args.id,
    deleted_message: (source.summary ?? '').slice(0, 100),
  };
}
