/**
 * Get Source Handler - Retrieve full source document details
 */

import { getSourceById } from '../../core/vector-store.js';
import { readFile } from 'fs/promises';
import path from 'path';

interface GetSourceArgs {
  source_id: string;
  include_content?: boolean;
}

export async function handleGetSource(
  dbPath: string,
  dataDir: string,
  args: GetSourceArgs
): Promise<unknown> {
  const { source_id, include_content = false } = args;

  const source = await getSourceById(dbPath, source_id);

  if (!source) {
    return { error: `Source not found: ${source_id}` };
  }

  const result: Record<string, unknown> = {
    id: source.id,
    title: source.title,
    source_type: source.source_type,
    content_type: source.content_type,
    projects: source.projects,
    tags: source.tags,
    created_at: source.created_at,
    summary: source.summary,
    themes: source.themes,
    quotes: source.quotes,
    source_url: source.source_url || undefined,
    source_name: source.source_name || undefined,
  };

  // Include full content if requested
  if (include_content) {
    try {
      const contentPath = path.join(dataDir, 'sources', source_id, 'content.md');
      const content = await readFile(contentPath, 'utf-8');

      // Skip reconciliation stubs — they only contain the summary
      if (content.startsWith('<!-- lore:stub -->')) {
        result.full_content = null;
        result.content_note = 'Content not yet synced to this machine. Only summary available.';
      } else if (content.startsWith('<<<<<<< ')) {
        // Git merge conflict markers — file is corrupted, don't return garbled content
        result.full_content = null;
        result.content_note = 'Content file has unresolved git merge conflicts. Run `lore sync` or resolve manually.';
      } else {
        result.full_content = content;
      }
    } catch {
      result.full_content = null;
      result.content_note = 'Full content not available on disk';
    }
  }

  return result;
}
