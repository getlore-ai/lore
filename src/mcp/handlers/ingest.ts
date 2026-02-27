/**
 * Ingest Handler - Primary agent-facing surface for pushing content into Lore
 *
 * Agents (Claude Code, OpenClaw, ChatGPT, etc.) use this to push content
 * from external systems (Slack, Notion, GitHub, meetings, etc.) into Lore.
 * Content is deduplicated by SHA256 hash, saved to disk, and immediately indexed.
 */

import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { randomUUID, createHash } from 'crypto';
import {
  addSource,
  checkContentHashExists,
  getSourceById,
  deleteSource,
  updateSourceContent,
  updateSourceTitle,
} from '../../core/vector-store.js';
import { generateEmbedding, createSearchableText } from '../../core/embedder.js';
import { extractInsights } from '../../core/insight-extractor.js';
import { gitCommitAndPush } from '../../core/git.js';
import { computeSourcePath, addToPathIndex } from '../../core/source-paths.js';
import type { SourceRecord, ContentType } from '../../core/types.js';
import { getExtensionRegistry } from '../../extensions/registry.js';
import { scheduleBriefUpdate } from '../../core/brief-auto-update.js';

interface IngestArgs {
  action?: 'add' | 'update' | 'delete';
  id?: string;
  content?: string;
  title?: string;
  project?: string;
  source_type?: string;
  date?: string;
  participants?: string[];
  tags?: string[];
  source_url?: string;
  source_name?: string;
}

// Normalize source_type to canonical kebab-case form.
// Agents pass free-form strings — this ensures consistency for filtering.
const SOURCE_TYPE_ALIASES: Record<string, string> = {
  // Granola
  'granola': 'meeting',
  'granola-app': 'meeting',
  'granola meeting': 'meeting',
  // Meetings
  'meeting notes': 'meeting',
  'meeting-notes': 'meeting',
  'meetings': 'meeting',
  // Interviews
  'interviews': 'interview',
  'user interview': 'interview',
  'user-interview': 'interview',
  // Slack
  'slack thread': 'slack',
  'slack-thread': 'slack',
  'slack message': 'slack',
  'slack-message': 'slack',
  // Email
  'emails': 'email',
  'email thread': 'email',
  'email-thread': 'email',
  // GitHub
  'github issue': 'github-issue',
  'github-pr': 'github-pr',
  'github pull request': 'github-pr',
  'pull request': 'github-pr',
  'pull-request': 'github-pr',
  // Notion
  'notion page': 'notion',
  'notion-page': 'notion',
  // Conversations
  'conversations': 'conversation',
  'chat': 'conversation',
  // Notes
  'notes': 'notes',
  'note': 'notes',
  // Documents
  'doc': 'document',
  'docs': 'document',
  'documents': 'document',
  'markdown': 'document',
  'md': 'document',
  // Articles
  'blog post': 'article',
  'blog-post': 'article',
  'web article': 'article',
  'web-article': 'article',
  'online article': 'article',
  'blog': 'article',
  'post': 'article',
  // Media / files
  'pdf': 'pdf',
  'pdf document': 'pdf',
  'docx': 'document',
  'word doc': 'document',
  'word document': 'document',
  'google doc': 'document',
  'google-doc': 'document',
  'image': 'image',
  'screenshot': 'image',
  'photo': 'image',
  'diagram': 'image',
  'video': 'video',
  'recording': 'video',
  'loom': 'video',
  'audio': 'audio',
  'podcast': 'audio',
  'voice memo': 'audio',
  'voice-memo': 'audio',
  // Specs / RFCs
  'specification': 'spec',
  'rfc': 'rfc',
  'design doc': 'spec',
  'design-doc': 'spec',
  // Transcripts
  'transcript': 'transcript',
  // Legacy types
  'claude-code': 'conversation',
  'claude-desktop': 'conversation',
  'chatgpt': 'conversation',
};

function normalizeSourceType(raw?: string): string {
  if (!raw) return 'document';
  const key = raw.toLowerCase().trim();
  return SOURCE_TYPE_ALIASES[key] || key.toLowerCase().replace(/\s+/g, '-');
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
    case 'note':
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
  options: { autoPush?: boolean; hookContext?: { mode: 'mcp' | 'cli' } } = {}
): Promise<unknown> {
  const action: string = args.action || 'add';

  switch (action) {
    case 'add':
      return handleIngestAdd(dbPath, dataDir, args, options);
    case 'update':
      return handleIngestUpdate(dbPath, dataDir, args);
    case 'delete':
      return handleIngestDelete(dbPath, dataDir, args);
    default:
      throw new Error(`Unknown ingest action: ${action}. Use add, update, or delete.`);
  }
}

async function handleIngestAdd(
  dbPath: string,
  dataDir: string,
  args: IngestArgs,
  options: { autoPush?: boolean; hookContext?: { mode: 'mcp' | 'cli' } } = {}
): Promise<unknown> {
  if (!args.content) throw new Error('content is required for ingest add');
  if (!args.project) throw new Error('project is required for ingest add');

  const content = args.content;
  const rawProject = args.project;
  const {
    source_type: raw_source_type,
    date,
    participants = [],
    tags = [],
    source_url,
    source_name,
  } = args;
  const { autoPush = true, hookContext } = options;

  const source_type = normalizeSourceType(raw_source_type);
  const project = rawProject.toLowerCase().trim();

  // Auto-generate title if not provided
  const title = args.title || `${source_type.charAt(0).toUpperCase() + source_type.slice(1)}: ${content.slice(0, 50)}${content.length > 50 ? '...' : ''}`;

  // Content hash deduplication — skip everything if already ingested
  const contentHash = createHash('sha256').update(content).digest('hex');

  try {
    const exists = await checkContentHashExists(dbPath, contentHash);
    if (exists) {
      return {
        success: true,
        deduplicated: true,
        message: 'Content already exists in the knowledge base (identical content hash).',
      };
    }
  } catch (error) {
    // If dedup check fails, continue with ingestion rather than blocking
    console.error('Dedup check failed, continuing with ingestion:', error);
  }

  const id = randomUUID();
  const timestamp = date || new Date().toISOString();
  const contentType = mapContentType(source_type);

  // Create source directory structure (human-friendly layout)
  const relativePath = computeSourcePath(project, title, timestamp, id);
  const sourceDir = path.join(dataDir, 'sources', relativePath);
  await mkdir(sourceDir, { recursive: true });

  // Save metadata.json BEFORE updating path index — ensures rebuildPathIndex
  // can always recover from the on-disk state if addToPathIndex fails
  const metadata: Record<string, unknown> = {
    id,
    title,
    source_type: source_type,
    content_type: contentType,
    created_at: timestamp,
    imported_at: new Date().toISOString(),
    projects: [project],
    tags,
    participants,
    content_hash: contentHash,
  };
  if (source_url) {
    metadata.source_url = source_url;
  }
  if (source_name) {
    metadata.source_name = source_name;
  }
  await writeFile(path.join(sourceDir, 'metadata.json'), JSON.stringify(metadata, null, 2));
  await addToPathIndex(dataDir, id, relativePath);

  // Save content.md
  await writeFile(path.join(sourceDir, 'content.md'), content);

  // Extract insights using LLM (skip for short content)
  let summary = content.slice(0, 200) + (content.length > 200 ? '...' : '');
  let themes: Array<{ name: string; quotes: string[] }> = [];
  let quotes: Array<{ text: string; speaker?: string }> = [];

  const isShortContent = content.trim().length <= 500;

  if (isShortContent) {
    // Short content fast path — use content as its own summary, skip LLM extraction
    summary = content;
  } else {
    try {
      const insights = await extractInsights(content, title, id, { contentType });
      summary = insights.summary;
      themes = insights.themes.map((t) => ({ name: t.name, quotes: [] }));
      quotes = insights.quotes.map((q) => ({ text: q.text, speaker: q.speaker }));

      // Save insights.json
      await writeFile(
        path.join(sourceDir, 'insights.json'),
        JSON.stringify({ summary, themes, quotes }, null, 2)
      );
    } catch (error) {
      console.error('Failed to extract insights:', error);
      // Continue with basic summary
    }
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
      source_type,
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

    await addSource(dbPath, sourceRecord, vector, {
      content_hash: contentHash,
      source_url,
      source_name,
      content,
      content_size: Buffer.byteLength(content, 'utf-8'),
    });

    // Auto-push to git if enabled
    let pushed = false;
    if (autoPush) {
      const pushResult = await gitCommitAndPush(dataDir, `Ingest: ${title}`);
      pushed = pushResult.success && (pushResult.message?.includes('pushed') || false);
    }

    const result = {
      success: true,
      id,
      title,
      project,
      source_type,
      filepath: `sources/${relativePath}`,
      summary,
      indexed: true,
      synced: pushed,
    };

    await runSourceCreatedHook(
      {
        id,
        title,
        source_type: source_type,
        content_type: contentType,
        created_at: timestamp,
        imported_at: new Date().toISOString(),
        projects: [project],
        tags,
        source_path: sourceDir,
        content_hash: contentHash,
      },
      {
        mode: hookContext?.mode || 'mcp',
        dataDir,
        dbPath,
      }
    );

    scheduleBriefUpdate(dbPath, dataDir, project);

    return result;
  } catch (error) {
    console.error('Failed to index ingested document:', error);

    // Still try to push even if indexing failed
    let pushed = false;
    if (autoPush) {
      const pushResult = await gitCommitAndPush(dataDir, `Ingest: ${title}`);
      pushed = pushResult.success && (pushResult.message?.includes('pushed') || false);
    }

    const result = {
      success: true,
      id,
      title,
      project,
      source_type,
      filepath: `sources/${relativePath}`,
      indexed: false,
      synced: pushed,
      note: 'Saved to disk but indexing failed. Run "lore sync" to index.',
    };

    await runSourceCreatedHook(
      {
        id,
        title,
        source_type: source_type,
        content_type: contentType,
        created_at: timestamp,
        imported_at: new Date().toISOString(),
        projects: [project],
        tags,
        source_path: sourceDir,
        content_hash: contentHash,
      },
      {
        mode: hookContext?.mode || 'mcp',
        dataDir,
        dbPath,
      }
    );

    return result;
  }
}

async function handleIngestUpdate(
  dbPath: string,
  _dataDir: string,
  args: IngestArgs
): Promise<unknown> {
  if (!args.id) throw new Error('id is required for ingest update');
  if (!args.content) throw new Error('content is required for ingest update');

  const source = await getSourceById(dbPath, args.id);
  if (!source) throw new Error(`Source not found: ${args.id}`);

  const project = source.projects[0] || undefined;
  const isShort = args.content.trim().length <= 500;
  const summary = isShort
    ? args.content
    : args.content.slice(0, 200) + (args.content.length > 200 ? '...' : '');

  const searchableText = createSearchableText({
    type: 'summary',
    text: summary,
    project,
  });
  const embedding = await generateEmbedding(searchableText);

  const contentOk = await updateSourceContent(dbPath, args.id, args.content, embedding, { summary });
  if (!contentOk) throw new Error('Failed to update source content.');

  if (args.title) {
    await updateSourceTitle(dbPath, args.id, args.title);
  }

  return {
    success: true,
    id: args.id,
    title: args.title || source.title,
    project,
  };
}

async function handleIngestDelete(
  dbPath: string,
  dataDir: string,
  args: IngestArgs
): Promise<unknown> {
  if (!args.id) throw new Error('id is required for ingest delete');

  const source = await getSourceById(dbPath, args.id);
  if (!source) throw new Error(`Source not found: ${args.id}`);

  const result = await deleteSource(dbPath, args.id);
  if (!result.deleted) throw new Error('Failed to delete source.');

  // Add to blocklist so sync won't re-ingest
  if (result.contentHash) {
    const { addToBlocklist } = await import('../../core/blocklist.js');
    await addToBlocklist(dataDir, result.contentHash);
  }

  return {
    success: true,
    id: args.id,
    deleted_title: source.title,
  };
}

async function runSourceCreatedHook(
  event: {
    id: string;
    title: string;
    source_type: string;
    content_type: string;
    created_at: string;
    imported_at: string;
    projects: string[];
    tags: string[];
    source_path?: string;
    content_hash?: string;
    sync_source?: string;
    original_file?: string;
  },
  context: { mode: 'mcp' | 'cli'; dataDir: string; dbPath: string }
): Promise<void> {
  try {
    const registry = await getExtensionRegistry({
      logger: (message) => console.error(message),
    });
    await registry.runHook('onSourceCreated', event, {
      mode: context.mode,
      dataDir: context.dataDir,
      dbPath: context.dbPath,
    });
  } catch (error) {
    console.error('[extensions] Failed to run onSourceCreated hook:', error);
  }
}
