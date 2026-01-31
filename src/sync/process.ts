/**
 * Lore - Claude Processing (Phase 2)
 *
 * Uses Claude to extract metadata from new files:
 * - title: Descriptive title
 * - summary: 2-4 sentence summary with key takeaways
 * - date: ISO date if present
 * - participants: List of names if present
 * - content_type: interview|meeting|conversation|document|note|analysis
 *
 * Only called for NEW files (not already in Supabase).
 */

import { readFile, mkdir, writeFile, copyFile } from 'fs/promises';
import path from 'path';
import Anthropic from '@anthropic-ai/sdk';

import type { DiscoveredFile } from './discover.js';
import type { ContentType, SourceRecord } from '../core/types.js';
import { processFile, type ProcessedContent, type ImageMediaType } from './processors.js';
import { generateEmbedding, createSearchableText } from '../core/embedder.js';
import { addSource } from '../core/vector-store.js';
import { gitCommitAndPush } from '../core/git.js';

// ============================================================================
// Types
// ============================================================================

export interface ExtractedMetadata {
  title: string;
  summary: string;
  date: string | null;
  participants: string[];
  content_type: ContentType;
}

export interface ProcessedFile {
  file: DiscoveredFile;
  metadata: ExtractedMetadata;
  sourceId: string;
}

export interface ProcessResult {
  processed: ProcessedFile[];
  errors: Array<{ file: DiscoveredFile; error: string }>;
}

// ============================================================================
// Claude Client
// ============================================================================

let anthropic: Anthropic | null = null;

function getAnthropic(): Anthropic {
  if (!anthropic) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY environment variable is required');
    }
    anthropic = new Anthropic({ apiKey });
  }
  return anthropic;
}

// ============================================================================
// Metadata Extraction
// ============================================================================

const EXTRACTION_PROMPT = `Analyze this document and extract metadata. Return ONLY valid JSON with these fields:

{
  "title": "A descriptive title (create one if not obvious)",
  "summary": "2-4 sentences capturing key takeaways, findings, or purpose",
  "date": "ISO date string (YYYY-MM-DD) if mentioned, otherwise null",
  "participants": ["list", "of", "names"] if this is a meeting/interview, otherwise [],
  "content_type": "one of: interview|meeting|conversation|document|note|analysis"
}

Content type guidelines:
- interview: User research, customer interview, 1:1 feedback session
- meeting: Team meeting, standup, planning session
- conversation: AI chat (Claude, ChatGPT), chat logs
- document: Spec, design doc, report, article
- note: Personal notes, memo, quick thoughts
- analysis: Competitor analysis, market research, data analysis

Be specific in the summary. Include concrete details, names, numbers when present.`;

export async function extractMetadata(
  content: string,
  filePath: string,
  options: {
    model?: string;
    image?: { base64: string; mediaType: ImageMediaType };
  } = {}
): Promise<ExtractedMetadata> {
  const { model = 'claude-sonnet-4-20250514', image } = options;
  const client = getAnthropic();

  // Build message content based on whether we have an image or text
  let messageContent: Anthropic.MessageCreateParams['messages'][0]['content'];

  if (image) {
    // Image analysis with Claude Vision
    messageContent = [
      {
        type: 'image' as const,
        source: {
          type: 'base64' as const,
          media_type: image.mediaType,
          data: image.base64,
        },
      },
      {
        type: 'text' as const,
        text: `${EXTRACTION_PROMPT}\n\nFile: ${path.basename(filePath)}\n\nAnalyze this image and extract metadata. Describe what's in the image in detail in the summary.`,
      },
    ];
  } else {
    // Text-based analysis
    const maxChars = 50000;
    const truncatedContent = content.length > maxChars
      ? content.substring(0, maxChars) + '\n\n[Content truncated...]'
      : content;

    messageContent = `${EXTRACTION_PROMPT}\n\nFile: ${path.basename(filePath)}\n\n---\n\n${truncatedContent}`;
  }

  const response = await client.messages.create({
    model,
    max_tokens: 1000,
    messages: [
      {
        role: 'user',
        content: messageContent,
      },
    ],
  });

  // Extract text from response
  const responseText = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map(block => block.text)
    .join('');

  // Parse JSON from response
  try {
    // Find JSON in response (handle markdown code blocks)
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in response');
    }

    const parsed = JSON.parse(jsonMatch[0]);

    // Validate and normalize
    return {
      title: parsed.title || path.basename(filePath),
      summary: parsed.summary || 'No summary available',
      date: parsed.date || null,
      participants: Array.isArray(parsed.participants) ? parsed.participants : [],
      content_type: validateContentType(parsed.content_type),
    };
  } catch (error) {
    console.error('[process] Error parsing Claude response:', error);
    console.error('[process] Raw response:', responseText);

    // Return fallback metadata
    return {
      title: path.basename(filePath),
      summary: content.substring(0, 200) + '...',
      date: null,
      participants: [],
      content_type: 'document',
    };
  }
}

function validateContentType(type: string): ContentType {
  const validTypes: ContentType[] = [
    'interview', 'meeting', 'conversation', 'document', 'note', 'analysis',
  ];

  if (validTypes.includes(type as ContentType)) {
    return type as ContentType;
  }

  return 'document';
}

// ============================================================================
// Source Storage
// ============================================================================

function generateSourceId(): string {
  // Generate a UUID for compatibility with Supabase schema
  return crypto.randomUUID();
}

async function storeSourceToDisk(
  sourceId: string,
  file: DiscoveredFile,
  metadata: ExtractedMetadata,
  processedContent: string,
  dataDir: string
): Promise<void> {
  const sourcesDir = path.join(dataDir, 'sources');
  const sourceDir = path.join(sourcesDir, sourceId);

  // Create source directory
  await mkdir(sourceDir, { recursive: true });

  // Copy original file
  const originalExt = path.extname(file.absolutePath);
  await copyFile(file.absolutePath, path.join(sourceDir, `original${originalExt}`));

  // Save processed content
  await writeFile(path.join(sourceDir, 'content.md'), processedContent);

  // Save metadata
  const sourceMetadata = {
    id: sourceId,
    title: metadata.title,
    source_type: 'document',  // Universal type for sync-ingested sources
    content_type: metadata.content_type,
    created_at: metadata.date || new Date().toISOString(),
    imported_at: new Date().toISOString(),
    projects: [file.project],
    tags: [],
    source_path: file.absolutePath,
    content_hash: file.contentHash,
    sync_source: file.sourceName,
    original_file: file.relativePath,
  };

  await writeFile(
    path.join(sourceDir, 'metadata.json'),
    JSON.stringify(sourceMetadata, null, 2)
  );

  // Save insights (summary + themes placeholder)
  await writeFile(
    path.join(sourceDir, 'insights.json'),
    JSON.stringify({ summary: metadata.summary, themes: [], quotes: [] }, null, 2)
  );
}

async function indexSource(
  sourceId: string,
  file: DiscoveredFile,
  metadata: ExtractedMetadata,
  dbPath: string
): Promise<void> {
  // Generate embedding
  const searchableText = createSearchableText({
    type: 'summary',
    text: metadata.summary,
    project: file.project,
  });
  const vector = await generateEmbedding(searchableText);

  // Create source record
  const sourceRecord: SourceRecord = {
    id: sourceId,
    title: metadata.title,
    source_type: 'document',
    content_type: metadata.content_type,
    projects: JSON.stringify([file.project]),
    tags: JSON.stringify([]),
    created_at: metadata.date || new Date().toISOString(),
    summary: metadata.summary,
    themes_json: JSON.stringify([]),
    quotes_json: JSON.stringify([]),
    has_full_content: true,
    vector: [],
  };

  // Add to vector store with content_hash and source_path
  await addSource(dbPath, sourceRecord, vector, {
    content_hash: file.contentHash,
    source_path: file.absolutePath,
  });
}

// ============================================================================
// Main Processing Function
// ============================================================================

export async function processFiles(
  files: DiscoveredFile[],
  dataDir: string,
  options: {
    onProgress?: (completed: number, total: number, title: string) => void;
    model?: string;
    concurrency?: number;
    gitPush?: boolean;
  } = {}
): Promise<ProcessResult> {
  const {
    onProgress,
    model = 'claude-sonnet-4-20250514',
    concurrency = 2,
    gitPush = true,
  } = options;

  const dbPath = path.join(dataDir, 'lore.lance');
  const result: ProcessResult = {
    processed: [],
    errors: [],
  };

  // Process files with controlled concurrency
  for (let i = 0; i < files.length; i += concurrency) {
    const batch = files.slice(i, i + concurrency);

    const batchResults = await Promise.allSettled(
      batch.map(async (file) => {
        // 1. Read and preprocess file
        const processed = await processFile(file.absolutePath);

        // 2. Extract metadata with Claude (handles both text and images)
        const metadata = await extractMetadata(
          processed.text,
          file.absolutePath,
          { model, image: processed.image }
        );

        // For images, use the summary as the text content
        const contentText = processed.image
          ? `# ${metadata.title}\n\n${metadata.summary}`
          : processed.text;

        // 3. Use existing ID for edits, generate new ID for new files
        const sourceId = file.existingId || generateSourceId();

        // 4. Index in Supabase FIRST (may fail on duplicate content_hash)
        await indexSource(sourceId, file, metadata, dbPath);

        // 5. Store source to disk ONLY if Supabase succeeded
        await storeSourceToDisk(
          sourceId,
          file,
          metadata,
          contentText,
          dataDir
        );

        return { file, metadata, sourceId };
      })
    );

    // Collect results
    for (let j = 0; j < batchResults.length; j++) {
      const batchResult = batchResults[j];
      const file = batch[j];

      if (batchResult.status === 'fulfilled') {
        result.processed.push(batchResult.value);
        onProgress?.(
          result.processed.length + result.errors.length,
          files.length,
          batchResult.value.metadata.title
        );
      } else {
        result.errors.push({
          file,
          error: batchResult.reason?.message || String(batchResult.reason),
        });
        onProgress?.(
          result.processed.length + result.errors.length,
          files.length,
          `Error: ${file.relativePath}`
        );
      }
    }

    // Small delay between batches to avoid rate limits
    if (i + concurrency < files.length) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  // Git commit and push if enabled
  if (gitPush && result.processed.length > 0) {
    await gitCommitAndPush(
      dataDir,
      `Sync: Added ${result.processed.length} source(s) from universal sync`
    );
  }

  return result;
}
