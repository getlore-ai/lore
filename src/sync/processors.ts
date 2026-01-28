/**
 * Lore - Format Preprocessors
 *
 * Converts various file formats to plain text for Claude analysis.
 * All processing is IN MEMORY ONLY - original files are never modified.
 */

import { readFile } from 'fs/promises';
import path from 'path';

// ============================================================================
// Types
// ============================================================================

export interface ProcessedContent {
  text: string;           // Extracted text content
  format: string;         // Original format (md, jsonl, json, etc.)
  metadata?: {
    title?: string;
    date?: string;
    participants?: string[];
  };
}

// ============================================================================
// Markdown Processing
// ============================================================================

function processMarkdown(content: string): ProcessedContent {
  // Markdown is already text, just return as-is
  // Extract title from first H1 if present
  const titleMatch = content.match(/^#\s+(.+)$/m);

  return {
    text: content,
    format: 'markdown',
    metadata: titleMatch ? { title: titleMatch[1] } : undefined,
  };
}

// ============================================================================
// JSONL Processing (Claude Code conversations, etc.)
// ============================================================================

interface JSONLMessage {
  role?: string;
  type?: string;
  content?: string | Array<{ type: string; text?: string }>;
  message?: {
    role?: string;
    content?: string | Array<{ type: string; text?: string }>;
  };
}

function extractTextContent(content: string | Array<{ type: string; text?: string }>): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter(c => c.type === 'text' && c.text)
      .map(c => c.text)
      .join('\n');
  }
  return '';
}

function processJSONL(content: string): ProcessedContent {
  const lines = content.split('\n').filter(line => line.trim());
  const messages: string[] = [];

  for (const line of lines) {
    try {
      const obj: JSONLMessage = JSON.parse(line);

      // Handle various JSONL formats
      if (obj.message?.content) {
        const role = obj.message.role || obj.type || 'unknown';
        const text = extractTextContent(obj.message.content);
        if (text) {
          messages.push(`[${role.toUpperCase()}]: ${text}`);
        }
      } else if (obj.content) {
        const role = obj.role || obj.type || 'unknown';
        const text = extractTextContent(obj.content);
        if (text) {
          messages.push(`[${role.toUpperCase()}]: ${text}`);
        }
      }
    } catch {
      // Skip invalid JSON lines
    }
  }

  return {
    text: messages.join('\n\n'),
    format: 'jsonl',
  };
}

// ============================================================================
// JSON Processing (Granola document.json, etc.)
// ============================================================================

interface GranolaDocument {
  id?: string;
  title?: string;
  created_at?: string;
  notes?: { type: string; content: unknown[] };
  transcript?: {
    utterances?: Array<{
      text: string;
      start: number;
      source: 'microphone' | 'system';
    }>;
  };
}

function proseMirrorToText(node: unknown): string {
  if (!node || typeof node !== 'object') return '';

  const n = node as { type?: string; text?: string; content?: unknown[] };

  if (n.type === 'text') return n.text || '';

  if (Array.isArray(n.content)) {
    return n.content.map(proseMirrorToText).join('');
  }

  return '';
}

function processJSON(content: string, filePath: string): ProcessedContent {
  try {
    const data = JSON.parse(content);

    // Check if it's a Granola document
    if (data.notes || data.transcript) {
      const doc = data as GranolaDocument;
      const parts: string[] = [];

      // Extract notes
      if (doc.notes?.content) {
        const notesText = proseMirrorToText(doc.notes);
        if (notesText) {
          parts.push('## Notes\n' + notesText);
        }
      }

      // Extract transcript
      if (doc.transcript?.utterances) {
        const transcriptText = doc.transcript.utterances
          .map(u => {
            const speaker = u.source === 'microphone' ? '[ME]' : '[PARTICIPANT]';
            const mins = Math.floor(u.start / 60);
            const secs = Math.floor(u.start % 60);
            const timestamp = `[${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}]`;
            return `${timestamp} ${speaker}: ${u.text}`;
          })
          .join('\n\n');

        if (transcriptText) {
          parts.push('## Transcript\n' + transcriptText);
        }
      }

      return {
        text: parts.join('\n\n'),
        format: 'json-granola',
        metadata: {
          title: doc.title,
          date: doc.created_at,
        },
      };
    }

    // Generic JSON - just stringify nicely
    return {
      text: JSON.stringify(data, null, 2),
      format: 'json',
    };
  } catch {
    return {
      text: content,
      format: 'json-invalid',
    };
  }
}

// ============================================================================
// Plain Text Processing
// ============================================================================

function processPlainText(content: string): ProcessedContent {
  return {
    text: content,
    format: 'text',
  };
}

// ============================================================================
// Main Processing Function
// ============================================================================

export async function processFile(filePath: string): Promise<ProcessedContent> {
  const content = await readFile(filePath, 'utf-8');
  const ext = path.extname(filePath).toLowerCase();

  switch (ext) {
    case '.md':
    case '.markdown':
      return processMarkdown(content);

    case '.jsonl':
      return processJSONL(content);

    case '.json':
      return processJSON(content, filePath);

    case '.txt':
      return processPlainText(content);

    default:
      // Try to detect format from content
      if (content.trim().startsWith('{') || content.trim().startsWith('[')) {
        return processJSON(content, filePath);
      }
      if (content.includes('{"')) {
        // Might be JSONL
        return processJSONL(content);
      }
      return processPlainText(content);
  }
}

// ============================================================================
// Batch Processing
// ============================================================================

export async function preprocessFiles(
  filePaths: string[],
  options: {
    onProgress?: (completed: number, total: number) => void;
  } = {}
): Promise<Map<string, ProcessedContent>> {
  const { onProgress } = options;
  const results = new Map<string, ProcessedContent>();

  for (let i = 0; i < filePaths.length; i++) {
    try {
      const processed = await processFile(filePaths[i]);
      results.set(filePaths[i], processed);
    } catch (error) {
      // Store error as metadata
      results.set(filePaths[i], {
        text: '',
        format: 'error',
        metadata: { title: `Error: ${error}` },
      });
    }
    onProgress?.(i + 1, filePaths.length);
  }

  return results;
}
