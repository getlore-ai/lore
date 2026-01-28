/**
 * Lore - Markdown Adapter
 *
 * Ingests markdown files and directories as source documents.
 * Supports frontmatter for metadata extraction.
 */

import { readFile, readdir, stat } from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import type { SourceDocument, Quote, Theme, ContentType } from '../core/types.js';
import { extractInsights } from '../core/insight-extractor.js';

/**
 * Simple frontmatter parser
 */
function parseFrontmatter(content: string): {
  frontmatter: Record<string, string | string[]>;
  body: string;
} {
  const frontmatterRegex = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/;
  const match = content.match(frontmatterRegex);

  if (!match) {
    return { frontmatter: {}, body: content };
  }

  const frontmatterLines = match[1].split('\n');
  const frontmatter: Record<string, string | string[]> = {};

  for (const line of frontmatterLines) {
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) continue;

    const key = line.substring(0, colonIndex).trim();
    let value = line.substring(colonIndex + 1).trim();

    // Handle arrays (simple YAML list format)
    if (value.startsWith('[') && value.endsWith(']')) {
      frontmatter[key] = value
        .slice(1, -1)
        .split(',')
        .map((v) => v.trim().replace(/^["']|["']$/g, ''));
    } else {
      // Remove quotes if present
      value = value.replace(/^["']|["']$/g, '');
      frontmatter[key] = value;
    }
  }

  return { frontmatter, body: match[2] };
}

/**
 * Extract title from markdown content
 */
function extractTitle(content: string, filename: string): string {
  // Try to find first H1
  const h1Match = content.match(/^#\s+(.+)$/m);
  if (h1Match) {
    return h1Match[1].trim();
  }

  // Use filename without extension
  return path.basename(filename, path.extname(filename)).replace(/[-_]/g, ' ');
}

/**
 * Determine content type from frontmatter or content
 */
function determineContentType(
  frontmatter: Record<string, string | string[]>,
  content: string,
  filename: string
): ContentType {
  const type = frontmatter.type || frontmatter.content_type;
  if (typeof type === 'string') {
    const validTypes: ContentType[] = [
      'interview',
      'meeting',
      'conversation',
      'document',
      'note',
      'analysis',
      'survey',
      'research',
    ];
    if (validTypes.includes(type as ContentType)) {
      return type as ContentType;
    }
  }

  const lowerContent = content.toLowerCase();
  const lowerFilename = filename.toLowerCase();

  // Check filename patterns first
  if (lowerFilename.includes('competitor') || lowerFilename.includes('analysis')) {
    return 'analysis';
  }
  if (lowerFilename.includes('survey') || lowerFilename.includes('feedback')) {
    return 'survey';
  }
  if (lowerFilename.includes('interview')) {
    return 'interview';
  }
  if (lowerFilename.includes('meeting') || lowerFilename.includes('notes')) {
    return 'meeting';
  }

  // Infer from content patterns
  if (lowerContent.includes('survey') || lowerContent.includes('respondents') ||
      lowerContent.includes('% of users') || lowerContent.includes('responses:')) {
    return 'survey';
  }
  if (lowerContent.includes('competitor') || lowerContent.includes('market share') ||
      lowerContent.includes('competitive advantage') || lowerContent.includes('vs.')) {
    return 'analysis';
  }
  if (lowerContent.includes('interview') || lowerContent.includes('q:') ||
      lowerContent.includes('interviewee')) {
    return 'interview';
  }
  if (lowerContent.includes('meeting notes') || lowerContent.includes('attendees:') ||
      lowerContent.includes('action items:')) {
    return 'meeting';
  }
  if (lowerContent.includes('research') || lowerContent.includes('findings') ||
      lowerContent.includes('methodology')) {
    return 'research';
  }

  return 'document';
}

/**
 * Ingest a single markdown file
 */
export async function ingestMarkdownFile(
  filePath: string,
  options: {
    project?: string;
    tags?: string[];
    extractInsightsEnabled?: boolean;
  } = {}
): Promise<{
  source: SourceDocument;
  insights?: { summary: string; themes: Theme[]; quotes: Quote[] };
}> {
  const { project, tags = [], extractInsightsEnabled = true } = options;

  const content = await readFile(filePath, 'utf-8');
  const { frontmatter, body } = parseFrontmatter(content);
  const filename = path.basename(filePath);

  const title = (frontmatter.title as string) || extractTitle(body, filePath);
  const contentType = determineContentType(frontmatter, body, filename);

  // Extract metadata from frontmatter
  const createdAt = (frontmatter.date as string) ||
    (frontmatter.created_at as string) ||
    (await stat(filePath)).birthtime.toISOString();

  const docTags = Array.isArray(frontmatter.tags)
    ? frontmatter.tags
    : typeof frontmatter.tags === 'string'
      ? frontmatter.tags.split(',').map((t) => t.trim())
      : [];

  const projects = Array.isArray(frontmatter.projects)
    ? frontmatter.projects
    : typeof frontmatter.projects === 'string'
      ? [frontmatter.projects]
      : project
        ? [project]
        : [];

  const id = (frontmatter.id as string) || randomUUID();

  // Create source document
  const source: SourceDocument = {
    id,
    source_type: 'markdown',
    source_id: id,
    source_path: filePath,
    title,
    content: body,
    content_type: contentType,
    created_at: createdAt,
    imported_at: new Date().toISOString(),
    participants: [],
    projects: [...new Set([...projects, ...(project ? [project] : [])])],
    tags: [...new Set([...docTags, ...tags])],
  };

  // Extract insights if enabled
  let insights: { summary: string; themes: Theme[]; quotes: Quote[] } | undefined;
  if (extractInsightsEnabled && body.trim().length > 100) {
    insights = await extractInsights(body, title, id, {
      contentType,
    });
  }

  return { source, insights };
}

/**
 * List all markdown files in a directory (recursively)
 */
export async function listMarkdownFiles(
  dirPath: string
): Promise<Array<{ path: string; title: string }>> {
  const results: Array<{ path: string; title: string }> = [];

  async function scanDir(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        await scanDir(fullPath);
      } else if (entry.isFile() && (entry.name.endsWith('.md') || entry.name.endsWith('.markdown'))) {
        try {
          const content = await readFile(fullPath, 'utf-8');
          const { frontmatter, body } = parseFrontmatter(content);
          const title = (frontmatter.title as string) || extractTitle(body, entry.name);
          results.push({ path: fullPath, title });
        } catch {
          // Skip unreadable files
        }
      }
    }
  }

  await scanDir(dirPath);
  return results;
}

/**
 * Ingest all markdown files from a directory
 */
export async function ingestMarkdownDirectory(
  dirPath: string,
  options: {
    project?: string;
    tags?: string[];
    extractInsightsEnabled?: boolean;
    onProgress?: (current: number, total: number, title: string) => void;
    skipExisting?: string[];
  } = {}
): Promise<Array<{
  source: SourceDocument;
  insights?: { summary: string; themes: Theme[]; quotes: Quote[] };
}>> {
  const { project, tags = [], extractInsightsEnabled = true, onProgress, skipExisting = [] } = options;

  const files = await listMarkdownFiles(dirPath);
  const results: Array<{
    source: SourceDocument;
    insights?: { summary: string; themes: Theme[]; quotes: Quote[] };
  }> = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    onProgress?.(i + 1, files.length, file.title);

    // Check if already ingested by path
    const pathHash = Buffer.from(file.path).toString('base64').slice(0, 16);
    if (skipExisting.some((id) => id.includes(pathHash))) {
      continue;
    }

    try {
      const result = await ingestMarkdownFile(file.path, {
        project,
        tags,
        extractInsightsEnabled,
      });
      results.push(result);
    } catch (error) {
      console.error(`Error ingesting ${file.path}:`, error);
    }
  }

  return results;
}
