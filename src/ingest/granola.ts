/**
 * Lore - Granola Adapter
 *
 * Ingests exports from granola-extractor and converts to Lore SourceDocument format.
 */

import { readFile, readdir, stat } from 'fs/promises';
import path from 'path';
import type { SourceDocument, Quote, Theme, ContentType } from '../core/types.js';
import { extractInsights } from '../core/insight-extractor.js';

/**
 * Granola document.json structure
 */
interface GranolaDocument {
  id: string;
  created_at: string;
  title?: string;
  notes?: {
    type: string;
    content: any[];
  };
  folders?: Array<{ name: string }>;
  transcript?: {
    panels?: any[];
    utterances?: Array<{
      text: string;
      start: number;
      end: number;
      source: 'microphone' | 'system';
    }>;
  };
}

/**
 * Convert ProseMirror content to plain text
 */
function proseMirrorToText(node: any): string {
  if (!node) return '';

  if (typeof node === 'string') return node;

  if (node.type === 'text') {
    return node.text || '';
  }

  if (node.content && Array.isArray(node.content)) {
    return node.content.map(proseMirrorToText).join('');
  }

  return '';
}

/**
 * Convert ProseMirror content to markdown
 */
function proseMirrorToMarkdown(node: any, depth: number = 0): string {
  if (!node) return '';

  if (typeof node === 'string') return node;

  if (node.type === 'text') {
    let text = node.text || '';
    if (node.marks) {
      for (const mark of node.marks) {
        if (mark.type === 'bold') text = `**${text}**`;
        if (mark.type === 'italic') text = `*${text}*`;
        if (mark.type === 'code') text = `\`${text}\``;
      }
    }
    return text;
  }

  const children = node.content
    ? node.content.map((c: any) => proseMirrorToMarkdown(c, depth)).join('')
    : '';

  switch (node.type) {
    case 'doc':
      return children;
    case 'paragraph':
      return children + '\n\n';
    case 'heading':
      const level = node.attrs?.level || 1;
      return '#'.repeat(level) + ' ' + children + '\n\n';
    case 'bulletList':
      return node.content
        .map((item: any) => '- ' + proseMirrorToMarkdown(item, depth + 1))
        .join('');
    case 'orderedList':
      return node.content
        .map((item: any, i: number) => `${i + 1}. ` + proseMirrorToMarkdown(item, depth + 1))
        .join('');
    case 'listItem':
      return children.trim() + '\n';
    case 'blockquote':
      return '> ' + children.replace(/\n/g, '\n> ') + '\n';
    case 'codeBlock':
      return '```\n' + children + '\n```\n\n';
    default:
      return children;
  }
}

/**
 * Format transcript with speaker labels
 */
function formatTranscript(
  utterances: Array<{
    text: string;
    start: number;
    end: number;
    source: 'microphone' | 'system';
  }> | undefined
): string {
  if (!utterances || utterances.length === 0) return '';

  return utterances
    .map((u) => {
      const speaker = u.source === 'microphone' ? '[ME]' : '[PARTICIPANT]';
      const timestamp = formatTimestamp(u.start);
      return `${timestamp} ${speaker}: ${u.text}`;
    })
    .join('\n\n');
}

/**
 * Format seconds to MM:SS
 */
function formatTimestamp(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `[${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}]`;
}

/**
 * Ingest a single Granola export folder
 */
export async function ingestGranolaDocument(
  folderPath: string,
  options: {
    project?: string;
    extractInsightsEnabled?: boolean;
  } = {}
): Promise<{
  source: SourceDocument;
  notes: string;
  transcript: string;
  insights?: { summary: string; themes: Theme[]; quotes: Quote[] };
}> {
  const { project, extractInsightsEnabled = true } = options;

  // Read document.json
  const documentPath = path.join(folderPath, 'document.json');
  const documentContent = await readFile(documentPath, 'utf-8');
  const doc: GranolaDocument = JSON.parse(documentContent);

  // Extract title from folder name or document
  const folderName = path.basename(folderPath);
  const title = doc.title || folderName.replace(/_/g, ' ');

  // Read notes.md if exists
  let notes = '';
  try {
    notes = await readFile(path.join(folderPath, 'notes.md'), 'utf-8');
  } catch {
    // Convert ProseMirror to markdown
    if (doc.notes?.content) {
      notes = proseMirrorToMarkdown(doc.notes);
    }
  }

  // Read transcript
  let transcript = '';
  try {
    const transcriptMd = await readFile(path.join(folderPath, 'transcript.md'), 'utf-8');
    if (transcriptMd.trim()) {
      transcript = transcriptMd;
    }
  } catch {
    // Try transcript.json
    try {
      const transcriptJson = await readFile(path.join(folderPath, 'transcript.json'), 'utf-8');
      const transcriptData = JSON.parse(transcriptJson);
      if (transcriptData.utterances) {
        transcript = formatTranscript(transcriptData.utterances);
      }
    } catch {
      // Check if embedded in document.json
      if (doc.transcript?.utterances) {
        transcript = formatTranscript(doc.transcript.utterances);
      }
    }
  }

  // Determine content type
  const contentType: ContentType = title.toLowerCase().includes('interview')
    ? 'interview'
    : 'meeting';

  // Build full content for analysis
  const fullContent = `# ${title}\n\n## Notes\n${notes}\n\n## Transcript\n${transcript}`;

  // Create source document
  const source: SourceDocument = {
    id: doc.id,
    source_type: 'granola',
    source_id: doc.id,
    source_path: folderPath,
    title,
    content: fullContent,
    content_type: contentType,
    created_at: doc.created_at,
    imported_at: new Date().toISOString(),
    participants: [], // Could extract from transcript
    projects: project ? [project] : [],
    tags: doc.folders?.map((f) => f.name) || [],
  };

  // Extract insights if enabled
  let insights: { summary: string; themes: Theme[]; quotes: Quote[] } | undefined;
  if (extractInsightsEnabled && (notes || transcript)) {
    insights = await extractInsights(fullContent, title, doc.id, {
      contentType,
    });
  }

  return { source, notes, transcript, insights };
}

/**
 * Ingest all Granola exports from a directory
 */
export async function ingestGranolaExports(
  exportDir: string,
  options: {
    project?: string;
    extractInsightsEnabled?: boolean;
    onProgress?: (current: number, total: number, title: string) => void;
    skipExisting?: string[]; // IDs to skip
  } = {}
): Promise<
  Array<{
    source: SourceDocument;
    notes: string;
    transcript: string;
    insights?: { summary: string; themes: Theme[]; quotes: Quote[] };
  }>
> {
  const { project, extractInsightsEnabled = true, onProgress, skipExisting = [] } = options;

  // Get all subdirectories (each is a meeting)
  const entries = await readdir(exportDir, { withFileTypes: true });
  const meetingDirs = entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'vectors.lance')
    .map((e) => path.join(exportDir, e.name));

  const results: Array<{
    source: SourceDocument;
    notes: string;
    transcript: string;
    insights?: { summary: string; themes: Theme[]; quotes: Quote[] };
  }> = [];

  for (let i = 0; i < meetingDirs.length; i++) {
    const meetingDir = meetingDirs[i];
    const folderName = path.basename(meetingDir);

    try {
      // Check if document.json exists
      const docPath = path.join(meetingDir, 'document.json');
      try {
        await stat(docPath);
      } catch {
        continue; // Skip folders without document.json
      }

      // Read document ID to check if should skip
      const docContent = await readFile(docPath, 'utf-8');
      const doc = JSON.parse(docContent);
      if (skipExisting.includes(doc.id)) {
        onProgress?.(i + 1, meetingDirs.length, `Skipping: ${folderName}`);
        continue;
      }

      onProgress?.(i + 1, meetingDirs.length, folderName.replace(/_/g, ' '));

      const result = await ingestGranolaDocument(meetingDir, {
        project,
        extractInsightsEnabled,
      });

      results.push(result);
    } catch (error) {
      console.error(`Error ingesting ${folderName}:`, error);
    }
  }

  return results;
}

/**
 * Get list of Granola export folders without fully ingesting
 */
export async function listGranolaExports(
  exportDir: string
): Promise<Array<{ id: string; title: string; created_at: string; path: string }>> {
  const entries = await readdir(exportDir, { withFileTypes: true });
  const meetingDirs = entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'vectors.lance')
    .map((e) => path.join(exportDir, e.name));

  const results: Array<{ id: string; title: string; created_at: string; path: string }> = [];

  for (const meetingDir of meetingDirs) {
    try {
      const docPath = path.join(meetingDir, 'document.json');
      const docContent = await readFile(docPath, 'utf-8');
      const doc = JSON.parse(docContent);

      results.push({
        id: doc.id,
        title: doc.title || path.basename(meetingDir).replace(/_/g, ' '),
        created_at: doc.created_at,
        path: meetingDir,
      });
    } catch {
      // Skip invalid folders
    }
  }

  return results.sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
}
