/**
 * Ingest Handler - Add documents directly via MCP
 *
 * Allows ingesting full documents (meeting notes, interviews, analyses)
 * directly through the MCP interface without going through the CLI.
 * Documents are saved to disk and immediately indexed for search.
 */

import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import { addSource, addChunks } from '../../core/vector-store.js';
import { generateEmbedding, createSearchableText } from '../../core/embedder.js';
import { extractInsights } from '../../core/insight-extractor.js';
import { gitCommitAndPush } from '../../core/git.js';
import type { SourceRecord, ChunkRecord, ContentType } from '../../core/types.js';

interface IngestArgs {
  content: string;
  title: string;
  project: string;
  source_type?: 'meeting' | 'interview' | 'document' | 'notes' | 'analysis' | 'conversation';
  date?: string;
  participants?: string[];
  tags?: string[];
}

// Map source_type to ContentType
function mapContentType(sourceType?: string): ContentType {
  switch (sourceType) {
    case 'meeting':
      return 'meeting';
    case 'interview':
      return 'interview';
    case 'conversation':
      return 'conversation';
    case 'analysis':
      return 'analysis';
    case 'notes':
      return 'note';
    case 'document':
    default:
      return 'document';
  }
}

export async function handleIngest(
  dbPath: string,
  dataDir: string,
  args: IngestArgs,
  options: { autoPush?: boolean } = {}
): Promise<unknown> {
  const {
    content,
    title,
    project,
    source_type = 'document',
    date,
    participants = [],
    tags = [],
  } = args;
  const { autoPush = true } = options;

  const id = randomUUID();
  const timestamp = date || new Date().toISOString();
  const contentType = mapContentType(source_type);

  // Create source directory structure (matches CLI ingest format)
  const sourceDir = path.join(dataDir, 'sources', id);
  await mkdir(sourceDir, { recursive: true });

  // Save metadata.json
  const metadata = {
    id,
    title,
    source_type: 'markdown',
    content_type: contentType,
    created_at: timestamp,
    imported_at: new Date().toISOString(),
    projects: [project],
    tags,
    participants,
  };
  await writeFile(path.join(sourceDir, 'metadata.json'), JSON.stringify(metadata, null, 2));

  // Save content.md
  await writeFile(path.join(sourceDir, 'content.md'), content);

  // Extract insights using LLM
  let summary = content.slice(0, 200) + (content.length > 200 ? '...' : '');
  let themes: Array<{ name: string; quotes: string[] }> = [];
  let quotes: Array<{ text: string; speaker?: string }> = [];

  try {
    if (content.trim().length > 100) {
      const insights = await extractInsights(content, title, id, { contentType });
      summary = insights.summary;
      themes = insights.themes.map((t) => ({ name: t.name, quotes: [] }));
      quotes = insights.quotes.map((q) => ({ text: q.text, speaker: q.speaker }));

      // Save insights.json
      await writeFile(
        path.join(sourceDir, 'insights.json'),
        JSON.stringify({ summary, themes, quotes }, null, 2)
      );
    }
  } catch (error) {
    console.error('Failed to extract insights:', error);
    // Continue with basic summary
  }

  // Add to vector store immediately
  try {
    const searchableText = createSearchableText({
      type: 'summary',
      text: summary,
      project,
    });
    const vector = await generateEmbedding(searchableText);

    const sourceRecord: SourceRecord = {
      id,
      title,
      source_type: 'markdown',
      content_type: contentType,
      projects: JSON.stringify([project]),
      tags: JSON.stringify(tags),
      created_at: timestamp,
      summary,
      themes_json: JSON.stringify(themes),
      quotes_json: JSON.stringify([]),
      has_full_content: true,
      vector: [],
    };

    await addSource(dbPath, sourceRecord, vector);

    // Add content as a searchable chunk
    const contentChunk: ChunkRecord = {
      id: `${id}_chunk`,
      source_id: id,
      content: content.slice(0, 4000), // Limit chunk size
      type: 'summary',
      theme_name: '',
      vector: await generateEmbedding(
        createSearchableText({ type: 'summary', text: content.slice(0, 2000), project })
      ),
    };

    await addChunks(dbPath, [contentChunk]);

    // Auto-push to git if enabled
    let pushed = false;
    if (autoPush) {
      const pushResult = await gitCommitAndPush(dataDir, `Ingest: ${title}`);
      pushed = pushResult.success && (pushResult.message?.includes('pushed') || false);
    }

    return {
      success: true,
      id,
      title,
      project,
      source_type,
      filepath: `sources/${id}`,
      summary,
      indexed: true,
      synced: pushed,
    };
  } catch (error) {
    console.error('Failed to index ingested document:', error);

    // Still try to push even if indexing failed
    let pushed = false;
    if (autoPush) {
      const pushResult = await gitCommitAndPush(dataDir, `Ingest: ${title}`);
      pushed = pushResult.success && (pushResult.message?.includes('pushed') || false);
    }

    return {
      success: true,
      id,
      title,
      project,
      source_type,
      filepath: `sources/${id}`,
      indexed: false,
      synced: pushed,
      note: 'Saved to disk but indexing failed. Run "lore sync" to index.',
    };
  }
}
