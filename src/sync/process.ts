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
import { addSource, resetDatabaseConnection } from '../core/vector-store.js';
import { gitCommitAndPush } from '../core/git.js';
import { computeSourcePath, addToPathIndex } from '../core/source-paths.js';
import { getExtensionRegistry } from '../extensions/registry.js';

// ============================================================================
// Types
// ============================================================================

export interface ExtractedMetadata {
  title: string;
  summary: string;
  description?: string;  // Detailed text description (used for images)
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
    fileMetadata?: { filename: string; sizeBytes: number; createdAt: string; modifiedAt: string; exif?: Record<string, unknown> };
  } = {}
): Promise<ExtractedMetadata> {
  const { model = 'claude-sonnet-4-20250514', image, fileMetadata } = options;
  const client = getAnthropic();

  // Build message content based on whether we have an image or text
  let messageContent: Anthropic.MessageCreateParams['messages'][0]['content'];

  if (image) {
    // Image analysis with Claude Vision — extract metadata AND a detailed text description
    const imagePrompt = `Analyze this image and return ONLY valid JSON with these fields:

{
  "title": "A descriptive title for this image",
  "summary": "2-4 sentences capturing the key takeaway or purpose of this image",
  "description": "A comprehensive text description of everything in this image. Include all text, data, labels, numbers, charts, diagrams, and visual elements. Transcribe any visible text verbatim. For charts/graphs, describe the data points and trends. For screenshots, describe the UI elements and content. Be thorough — this description replaces the image in a text-only knowledge base.",
  "date": "ISO date string (YYYY-MM-DD) if mentioned, otherwise null",
  "participants": ["list", "of", "names"] if people are mentioned, otherwise [],
  "content_type": "one of: interview|meeting|conversation|document|note|analysis"
}

Be specific and thorough in the description. Include ALL visible text, numbers, and data.`;

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
        text: `${imagePrompt}\n\nFile: ${path.basename(filePath)}${fileMetadata ? `\nFile size: ${(fileMetadata.sizeBytes / 1024).toFixed(0)} KB\nFile created: ${fileMetadata.createdAt}\nFile modified: ${fileMetadata.modifiedAt}${fileMetadata.exif ? `\nEXIF data: ${JSON.stringify(fileMetadata.exif)}` : ''}` : ''}`,
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
    max_tokens: image ? 4000 : 1000,
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
      description: parsed.description || undefined,
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
  const createdAt = metadata.date || new Date().toISOString();
  const relativePath = computeSourcePath(file.project, metadata.title, createdAt, sourceId);
  const sourceDir = path.join(dataDir, 'sources', relativePath);

  // Create source directory
  await mkdir(sourceDir, { recursive: true });

  // Save metadata BEFORE updating path index — ensures rebuildPathIndex
  // can always recover from the on-disk state if addToPathIndex fails
  const sourceMetadata = {
    id: sourceId,
    title: metadata.title,
    source_type: 'document',  // Universal type for sync-ingested sources
    content_type: metadata.content_type,
    created_at: createdAt,
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
  await addToPathIndex(dataDir, sourceId, relativePath);

  // Copy original file (skip binary formats — knowledge store is text-based)
  const originalExt = path.extname(file.absolutePath).toLowerCase();
  const binaryExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.ico', '.svg'];
  if (!binaryExts.includes(originalExt)) {
    await copyFile(file.absolutePath, path.join(sourceDir, `original${originalExt}`));
  }

  // Save processed content
  await writeFile(path.join(sourceDir, 'content.md'), processedContent);

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
  dbPath: string,
  processedContent: string
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

  // Add to vector store with content_hash, source_path, and content
  await addSource(dbPath, sourceRecord, vector, {
    content_hash: file.contentHash,
    source_path: file.absolutePath,
    content: processedContent,
    content_size: Buffer.byteLength(processedContent, 'utf-8'),
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
    hookContext?: { mode: 'mcp' | 'cli' };
  } = {}
): Promise<ProcessResult> {
  const {
    onProgress,
    model = 'claude-sonnet-4-20250514',
    concurrency = 2,
    gitPush = true,
    hookContext,
  } = options;

  const dbPath = path.join(dataDir, 'lore.lance');
  const result: ProcessResult = {
    processed: [],
    errors: [],
  };

  const extensionRegistry = hookContext
    ? await getExtensionRegistry({ logger: (message) => console.error(message) })
    : null;

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
          { model, image: processed.image, fileMetadata: processed.fileMetadata }
        );

        // For images, use the detailed description as the text content
        let contentText: string;
        if (processed.image) {
          const lines = [
            `# ${metadata.title}`,
            '',
            metadata.description || metadata.summary,
            '',
            '---',
            '',
            `*Original file: ${path.basename(file.absolutePath)}*`,
            `*Synced from: ${file.sourceName}*`,
            metadata.date ? `*Date: ${metadata.date}*` : '',
          ];
          // Append EXIF metadata if available
          const exif = processed.fileMetadata?.exif;
          if (exif && Object.keys(exif).length > 0) {
            lines.push('');
            lines.push('## Image Metadata');
            for (const [key, value] of Object.entries(exif)) {
              if (value != null && value !== '') {
                const label = key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase()).trim();
                lines.push(`- **${label}:** ${Array.isArray(value) ? value.join(', ') : String(value)}`);
              }
            }
          }
          contentText = lines.filter(Boolean).join('\n');
        } else {
          contentText = processed.text;
        }

        // 3. Use existing ID for edits, generate new ID for new files
        const sourceId = file.existingId || generateSourceId();

        // 4. Store to disk FIRST — ensures content.md always exists
        //    If this fails, we skip Supabase so the file stays "new" for retry.
        try {
          await storeSourceToDisk(sourceId, file, metadata, contentText, dataDir);
        } catch (diskError) {
          console.error(`[process] Disk write failed for ${file.relativePath}: ${diskError}`);
          throw new Error(`Disk write failed for ${file.relativePath}: ${diskError}`);
        }

        // 5. Index in Supabase — if this fails, disk content still exists
        //    and legacy sync will pick it up on the next run.
        try {
          await indexSource(sourceId, file, metadata, dbPath, contentText);
        } catch (supabaseError: unknown) {
          const errObj = supabaseError as { code?: string; message?: string };
          const isAuthError = errObj?.code === 'PGRST303'
            || errObj?.message?.includes('JWT expired')
            || errObj?.message?.includes('Invalid JWT')
            || errObj?.message?.includes('Not authenticated');
          if (isAuthError) {
            // Auth errors will affect ALL remaining files — abort to prevent wasted LLM spend.
            // Reset the cached client so the next sync cycle starts with a fresh auth check.
            resetDatabaseConnection();
            console.error(`[process] Auth error for ${file.relativePath}: ${supabaseError}`);
            throw new Error(`Auth failed (JWT expired or invalid). Aborting sync to prevent wasted API spend. Run 'lore auth login' to re-authenticate.`);
          }
          console.error(`[process] Supabase index failed for ${file.relativePath}: ${supabaseError}`);
          console.error(`[process] Content saved to disk — will be indexed on next sync via legacy path`);
          // Don't re-throw for non-auth errors: disk write succeeded, source is safe
        }

        if (extensionRegistry && hookContext) {
          await extensionRegistry.runHook('onSourceCreated', {
            id: sourceId,
            title: metadata.title,
            source_type: 'document',
            content_type: metadata.content_type,
            created_at: metadata.date || new Date().toISOString(),
            imported_at: new Date().toISOString(),
            projects: [file.project],
            tags: [],
            source_path: file.absolutePath,
            content_hash: file.contentHash,
            sync_source: file.sourceName,
            original_file: file.relativePath,
          }, {
            mode: hookContext.mode,
            dataDir,
            dbPath,
          });
        }

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
        const errorMsg = batchResult.reason?.message || String(batchResult.reason);
        console.error(`[process] Failed to process ${file.relativePath}: ${errorMsg}`);
        result.errors.push({
          file,
          error: errorMsg,
        });
        onProgress?.(
          result.processed.length + result.errors.length,
          files.length,
          `Error: ${file.relativePath}`
        );
      }
    }

    // Abort all remaining batches if an auth error was detected.
    // Auth errors affect every subsequent Supabase call, so continuing
    // would only waste LLM spend on files that can't be indexed.
    const authAbort = result.errors.some(e => e.error.startsWith('Auth failed'));
    if (authAbort) break;

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
