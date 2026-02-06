/**
 * Retain Handler - Save insights, decisions, and notes
 *
 * This is the "push" mechanism for adding knowledge explicitly.
 * Retained items are immediately added to the vector store for instant searchability.
 * Auto-pushes to git remote if configured.
 */

import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import { addSource } from '../../core/vector-store.js';
import { generateEmbedding, createSearchableText } from '../../core/embedder.js';
import { gitCommitAndPush } from '../../core/git.js';
import type { SourceRecord } from '../../core/types.js';

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
  args: RetainArgs,
  options: { autoPush?: boolean } = {}
): Promise<unknown> {
  const { content, project, type, source_context, tags = [] } = args;
  const { autoPush = true } = options;

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

  // Save to disk
  const retainedDir = path.join(dataDir, 'retained', project);
  await mkdir(retainedDir, { recursive: true });

  const filename = `${type}-${id.slice(0, 8)}.json`;
  const filepath = path.join(retainedDir, filename);

  await writeFile(filepath, JSON.stringify(entry, null, 2));

  // Add to vector store immediately for instant searchability
  try {
    // Generate embedding for the content
    const searchableText = createSearchableText({
      type: type === 'decision' ? 'theme' : 'summary',
      text: content,
      project,
    });
    const vector = await generateEmbedding(searchableText);

    // Create source record
    const sourceRecord: SourceRecord = {
      id,
      title: `${type.charAt(0).toUpperCase() + type.slice(1)}: ${content.substring(0, 50)}...`,
      source_type: 'retained',
      content_type: type === 'decision' ? 'decision' : 'note',
      projects: JSON.stringify([project]),
      tags: JSON.stringify(tags),
      created_at: timestamp,
      summary: content,
      themes_json: JSON.stringify([]),
      quotes_json: JSON.stringify([]),
      has_full_content: true,
      vector: [],
    };

    await addSource(dbPath, sourceRecord, vector);

    // Auto-push to git if enabled
    let pushed = false;
    if (autoPush) {
      const pushResult = await gitCommitAndPush(
        dataDir,
        `Retain ${type}: ${content.substring(0, 50)}...`
      );
      pushed = pushResult.success && (pushResult.message?.includes('pushed') || false);
    }

    return {
      success: true,
      id,
      message: `Retained ${type} for project "${project}"`,
      indexed: true,
      synced: pushed,
    };
  } catch (error) {
    // Still saved to disk, just not indexed yet
    console.error('Failed to index retained item:', error);

    // Still try to push even if indexing failed
    let pushed = false;
    if (autoPush) {
      const pushResult = await gitCommitAndPush(
        dataDir,
        `Retain ${type}: ${content.substring(0, 50)}...`
      );
      pushed = pushResult.success && (pushResult.message?.includes('pushed') || false);
    }

    return {
      success: true,
      id,
      message: `Retained ${type} for project "${project}"`,
      indexed: false,
      synced: pushed,
      note: 'Saved to disk but indexing failed. Run "lore sync" to index.',
    };
  }
}
