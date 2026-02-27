/**
 * Get Source Handler - Retrieve full source document details
 */

import { getSourceById } from '../../core/vector-store.js';
import { readFile, writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { resolveSourceDir, computeSourcePath, addToPathIndex } from '../../core/source-paths.js';

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

    // Resolve source directory (index → legacy fallback)
    const sourceDir = await resolveSourceDir(dataDir, source_id);
    try {
      const contentPath = path.join(sourceDir, 'content.md');
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
      // Cache to disk — use human-friendly path for new caches
      try {
        const projects = typeof source.projects === 'string' ? JSON.parse(source.projects) : source.projects;
        const project = projects?.[0] || 'uncategorized';
        const relativePath = computeSourcePath(project, source.title, source.created_at, source_id);
        const cacheDir = path.join(dataDir, 'sources', relativePath);
        await mkdir(cacheDir, { recursive: true });
        await writeFile(path.join(cacheDir, 'content.md'), source.content);
        // Write minimal metadata.json so rebuildPathIndex can recover this entry
        await writeFile(path.join(cacheDir, 'metadata.json'), JSON.stringify({
          id: source_id,
          title: source.title,
          source_type: source.source_type,
          content_type: source.content_type,
          created_at: source.created_at,
          projects: projects || [],
          tags: typeof source.tags === 'string' ? JSON.parse(source.tags) : (source.tags || []),
        }, null, 2));
        await addToPathIndex(dataDir, source_id, relativePath);
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
