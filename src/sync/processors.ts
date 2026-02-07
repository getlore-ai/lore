/**
 * Lore - Format Preprocessors
 *
 * Converts various file formats to plain text for Claude analysis.
 * All processing is IN MEMORY ONLY - original files are never modified.
 */

import { readFile, stat } from 'fs/promises';
import path from 'path';
import Anthropic from '@anthropic-ai/sdk';

// PDF parser - dynamically imported to avoid issues if not installed
type PdfParser = (buffer: Buffer) => Promise<{ text: string }>;
let pdfParser: PdfParser | null = null;

async function getPdfParser(): Promise<PdfParser | null> {
  if (!pdfParser) {
    try {
      const { PDFParse } = await import('pdf-parse');
      // Wrap the class in a function
      pdfParser = async (buffer: Buffer): Promise<{ text: string }> => {
        const parser = new (PDFParse as any)({ data: buffer });
        await parser.load();
        const text = await parser.getText();
        return { text: text || '' };
      };
    } catch {
      return null;
    }
  }
  return pdfParser;
}

// ============================================================================
// Types
// ============================================================================

export type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

export interface ProcessedContent {
  text: string;           // Extracted text content (empty for images)
  format: string;         // Original format (md, jsonl, json, pdf, image, etc.)
  metadata?: {
    title?: string;
    date?: string;
    participants?: string[];
  };
  // For images - used with Claude vision
  image?: {
    base64: string;
    mediaType: ImageMediaType;
  };
  // File-level metadata extracted from the filesystem
  fileMetadata?: {
    filename: string;
    sizeBytes: number;
    createdAt: string;
    modifiedAt: string;
    exif?: Record<string, unknown>;
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
// PDF Processing
// ============================================================================

async function processPdf(filePath: string): Promise<ProcessedContent> {
  const parser = await getPdfParser();
  if (!parser) {
    return {
      text: '[PDF processing not available - install pdf-parse]',
      format: 'pdf-unsupported',
    };
  }

  const buffer = await readFile(filePath);
  const data = await parser(buffer);

  return {
    text: data.text,
    format: 'pdf',
    metadata: {
      title: path.basename(filePath, '.pdf'),
    },
  };
}

// ============================================================================
// Image Processing (for Claude Vision)
// ============================================================================

function getImageMediaType(ext: string): ImageMediaType | null {
  const types: Record<string, ImageMediaType> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
  };
  return types[ext.toLowerCase()] || null;
}

async function processImage(filePath: string): Promise<ProcessedContent> {
  const ext = path.extname(filePath).toLowerCase();
  const mediaType = getImageMediaType(ext);

  if (!mediaType) {
    return {
      text: '[Unsupported image format]',
      format: 'image-unsupported',
    };
  }

  const buffer = await readFile(filePath);
  const base64 = buffer.toString('base64');

  // Extract file-level metadata
  const fileStat = await stat(filePath);
  const filename = path.basename(filePath);

  // Try to parse date from common filename patterns (e.g. WhatsApp, screenshots)
  let dateFromFilename: string | undefined;
  const whatsappMatch = filename.match(/(\d{4}-\d{2}-\d{2})/);
  if (whatsappMatch) {
    dateFromFilename = whatsappMatch[1];
  }

  // Extract EXIF metadata (GPS, camera, date, etc.)
  let exifData: Record<string, unknown> | undefined;
  try {
    const exifr = await import('exifr');
    const raw = await exifr.default.parse(buffer, {
      // Request all available tags
      tiff: true,
      exif: true,
      gps: true,
      icc: false,      // Skip color profile (not useful for knowledge)
      iptc: true,       // Keywords, captions, copyright
      xmp: true,        // Extended metadata
    });
    if (raw) {
      // Extract the most useful fields
      exifData = {};
      // Camera info
      if (raw.Make) exifData.cameraMake = raw.Make;
      if (raw.Model) exifData.cameraModel = raw.Model;
      if (raw.LensModel) exifData.lens = raw.LensModel;
      // Date
      if (raw.DateTimeOriginal) exifData.dateTaken = raw.DateTimeOriginal instanceof Date ? raw.DateTimeOriginal.toISOString() : String(raw.DateTimeOriginal);
      if (raw.CreateDate) exifData.dateCreated = raw.CreateDate instanceof Date ? raw.CreateDate.toISOString() : String(raw.CreateDate);
      // GPS
      if (raw.latitude != null && raw.longitude != null) {
        exifData.gpsLatitude = raw.latitude;
        exifData.gpsLongitude = raw.longitude;
      }
      if (raw.GPSAltitude != null) exifData.gpsAltitude = raw.GPSAltitude;
      // Image dimensions
      if (raw.ImageWidth) exifData.width = raw.ImageWidth;
      if (raw.ImageHeight) exifData.height = raw.ImageHeight;
      if (raw.ExifImageWidth) exifData.width = raw.ExifImageWidth;
      if (raw.ExifImageHeight) exifData.height = raw.ExifImageHeight;
      // Software / source
      if (raw.Software) exifData.software = raw.Software;
      if (raw.Artist) exifData.artist = raw.Artist;
      if (raw.Copyright) exifData.copyright = raw.Copyright;
      // IPTC/XMP tags
      if (raw.Keywords) exifData.keywords = raw.Keywords;
      if (raw.Description) exifData.description = raw.Description;
      if (raw.Caption) exifData.caption = raw.Caption;
      if (raw.Subject) exifData.subject = raw.Subject;
      if (raw.Title) exifData.title = raw.Title;
      // Use EXIF date if no filename date
      if (!dateFromFilename && exifData.dateTaken) {
        const d = new Date(exifData.dateTaken as string);
        if (!isNaN(d.getTime())) {
          dateFromFilename = d.toISOString().split('T')[0];
        }
      }
      // Drop empty objects
      if (Object.keys(exifData).length === 0) exifData = undefined;
    }
  } catch (exifError) {
    console.error(`[processors] EXIF extraction failed for ${path.basename(filePath)}: ${exifError}`);
  }

  return {
    text: '', // Will be filled by Claude vision
    format: 'image',
    metadata: dateFromFilename ? { date: dateFromFilename } : undefined,
    image: {
      base64,
      mediaType,
    },
    fileMetadata: {
      filename,
      sizeBytes: fileStat.size,
      createdAt: fileStat.birthtime.toISOString(),
      modifiedAt: fileStat.mtime.toISOString(),
      ...(exifData ? { exif: exifData } : {}),
    },
  };
}

// ============================================================================
// CSV Processing
// ============================================================================

function processCsv(content: string, filePath: string): ProcessedContent {
  const lines = content.split('\n').filter(line => line.trim());
  if (lines.length === 0) {
    return { text: content, format: 'csv' };
  }

  // Parse header and data
  const header = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  const rows = lines.slice(1);

  // Convert to readable format
  const formatted = rows.map((row, idx) => {
    const values = row.split(',').map(v => v.trim().replace(/^"|"$/g, ''));
    const pairs = header.map((h, i) => `${h}: ${values[i] || ''}`);
    return `Row ${idx + 1}:\n  ${pairs.join('\n  ')}`;
  }).join('\n\n');

  return {
    text: `CSV Data (${rows.length} rows, ${header.length} columns)\n\nColumns: ${header.join(', ')}\n\n${formatted}`,
    format: 'csv',
    metadata: {
      title: path.basename(filePath, '.csv'),
    },
  };
}

// ============================================================================
// HTML Processing
// ============================================================================

function processHtml(content: string): ProcessedContent {
  // Simple HTML to text conversion
  let text = content
    // Remove scripts and styles
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    // Convert common elements
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<li>/gi, '• ')
    .replace(/<\/li>/gi, '\n')
    // Remove remaining tags
    .replace(/<[^>]+>/g, '')
    // Decode common entities
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    // Clean up whitespace
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  // Extract title from <title> tag
  const titleMatch = content.match(/<title[^>]*>([^<]+)<\/title>/i);

  return {
    text,
    format: 'html',
    metadata: titleMatch ? { title: titleMatch[1].trim() } : undefined,
  };
}

// ============================================================================
// XML Processing
// ============================================================================

function processXml(content: string): ProcessedContent {
  // Extract text content from XML, preserving structure
  const text = content
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1') // Unwrap CDATA
    .replace(/<[^>]+>/g, ' ') // Remove tags
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim();

  return {
    text: `XML Document:\n\n${text}`,
    format: 'xml',
  };
}

// ============================================================================
// Main Processing Function
// ============================================================================

export async function processFile(filePath: string): Promise<ProcessedContent> {
  const ext = path.extname(filePath).toLowerCase();

  // Handle binary formats first (before trying to read as utf-8)
  if (ext === '.pdf') {
    return processPdf(filePath);
  }

  const imageMediaType = getImageMediaType(ext);
  if (imageMediaType) {
    return processImage(filePath);
  }

  // Text-based formats
  const content = await readFile(filePath, 'utf-8');

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

    case '.csv':
      return processCsv(content, filePath);

    case '.html':
    case '.htm':
      return processHtml(content);

    case '.xml':
    case '.xhtml':
      return processXml(content);

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
