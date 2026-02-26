/**
 * Get Source Handler - Retrieve full source document details
 */

import { getSourceById } from '../../core/vector-store.js';
import { readFile, writeFile, mkdir } from 'fs/promises';
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

  // Fetch with content included when requested — single DB round-trip
  const source = await getSourceById(dbPath, source_id, {
    includeContent: include_content,
  });

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
    let diskContent: string | null = null;

    try {
      const contentPath = path.join(dataDir, 'sources', source_id, 'content.md');
      diskContent = await readFile(contentPath, 'utf-8');
    } catch {
      // File not on disk
    }

    // Use disk content if it's valid (not a stub or merge conflict)
    if (diskContent && !diskContent.startsWith('<!-- lore:stub -->') && !diskContent.startsWith('<<<<<<< ')) {
      result.full_content = diskContent;
    } else if (source.content) {
      // Use content already fetched from Lore Cloud
      result.full_content = source.content;
      // Cache to disk for future reads
      try {
        await mkdir(path.join(dataDir, 'sources', source_id), { recursive: true });
        await writeFile(path.join(dataDir, 'sources', source_id, 'content.md'), source.content);
      } catch {
        // Non-fatal — disk cache is nice-to-have
      }
    } else {
      result.full_content = null;
      result.content_note = 'Full content not available';
    }
  }

  return result;
}
