/**
 * Retain Handler - Save insights, decisions, and notes
 *
 * This is the "push" mechanism for adding knowledge explicitly.
 */

import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';

interface RetainArgs {
  content: string;
  project: string;
  type: 'insight' | 'decision' | 'requirement' | 'note';
  source_context?: string;
  tags?: string[];
}

export async function handleRetain(
  dbPath: string,
  dataDir: string,
  args: RetainArgs
): Promise<unknown> {
  const { content, project, type, source_context, tags = [] } = args;

  const id = randomUUID();
  const timestamp = new Date().toISOString();

  // Create the retained knowledge entry
  const entry = {
    id,
    content,
    project,
    type,
    source_context: source_context || 'Explicitly retained via MCP',
    tags,
    created_at: timestamp,
  };

  // Save to disk (will be indexed on next sync)
  const retainedDir = path.join(dataDir, 'retained', project);
  await mkdir(retainedDir, { recursive: true });

  const filename = `${type}-${id.slice(0, 8)}.json`;
  const filepath = path.join(retainedDir, filename);

  await writeFile(filepath, JSON.stringify(entry, null, 2));

  // TODO: Also add to vector store immediately for instant availability

  return {
    success: true,
    id,
    message: `Retained ${type} for project "${project}"`,
    note: 'Run "lore sync" to make this searchable immediately',
  };
}
