/**
 * Terminal markdown renderer
 *
 * Converts markdown to styled terminal output using ANSI codes.
 * Designed for blessed terminals.
 */

import { colors } from '../cli/colors.js';

/**
 * Render markdown to terminal-friendly styled text
 */
export function renderMarkdown(text: string, width: number = 80): string {
  const lines = text.split('\n');
  const result: string[] = [];
  let inCodeBlock = false;
  let codeBlockLang = '';

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    // Code blocks
    if (line.startsWith('```')) {
      if (!inCodeBlock) {
        inCodeBlock = true;
        codeBlockLang = line.slice(3).trim();
        result.push(`${colors.dim}┌${'─'.repeat(Math.min(width - 2, 40))}${colors.reset}`);
        continue;
      } else {
        inCodeBlock = false;
        codeBlockLang = '';
        result.push(`${colors.dim}└${'─'.repeat(Math.min(width - 2, 40))}${colors.reset}`);
        continue;
      }
    }

    if (inCodeBlock) {
      result.push(`${colors.dim}│${colors.reset} ${colors.yellow}${line}${colors.reset}`);
      continue;
    }

    // Headers
    if (line.startsWith('######')) {
      result.push(`${colors.bold}${colors.cyan}${line.slice(7).trim()}${colors.reset}`);
      continue;
    }
    if (line.startsWith('#####')) {
      result.push(`${colors.bold}${colors.cyan}${line.slice(6).trim()}${colors.reset}`);
      continue;
    }
    if (line.startsWith('####')) {
      result.push(`${colors.bold}${colors.cyan}${line.slice(5).trim()}${colors.reset}`);
      continue;
    }
    if (line.startsWith('###')) {
      result.push(`${colors.bold}${colors.cyan}${line.slice(4).trim()}${colors.reset}`);
      continue;
    }
    if (line.startsWith('##')) {
      result.push('');
      result.push(`${colors.bold}${colors.blue}${line.slice(3).trim()}${colors.reset}`);
      continue;
    }
    if (line.startsWith('#')) {
      result.push('');
      result.push(`${colors.bold}${colors.cyan}${'═'.repeat(Math.min(line.slice(2).trim().length, width))}${colors.reset}`);
      result.push(`${colors.bold}${colors.cyan}${line.slice(2).trim()}${colors.reset}`);
      result.push(`${colors.bold}${colors.cyan}${'═'.repeat(Math.min(line.slice(2).trim().length, width))}${colors.reset}`);
      continue;
    }

    // Horizontal rules
    if (/^[-*_]{3,}$/.test(line.trim())) {
      result.push(`${colors.dim}${'─'.repeat(Math.min(width, 60))}${colors.reset}`);
      continue;
    }

    // Blockquotes
    if (line.startsWith('>')) {
      const quoteText = line.slice(1).trim();
      result.push(`${colors.dim}│${colors.reset} ${colors.italic}${quoteText}${colors.reset}`);
      continue;
    }

    // Unordered lists
    if (/^\s*[-*+]\s/.test(line)) {
      const indent = line.match(/^(\s*)/)?.[1] || '';
      const content = line.replace(/^\s*[-*+]\s/, '');
      result.push(`${indent}${colors.yellow}•${colors.reset} ${renderInline(content)}`);
      continue;
    }

    // Ordered lists
    if (/^\s*\d+\.\s/.test(line)) {
      const match = line.match(/^(\s*)(\d+)\.\s(.*)/);
      if (match) {
        const [, indent, num, content] = match;
        result.push(`${indent}${colors.yellow}${num}.${colors.reset} ${renderInline(content)}`);
        continue;
      }
    }

    // Regular paragraph with inline formatting
    result.push(renderInline(line));
  }

  return result.join('\n');
}

/**
 * Render inline markdown elements
 */
function renderInline(text: string): string {
  // Bold **text** or __text__
  text = text.replace(/\*\*(.+?)\*\*/g, `${colors.bold}$1${colors.reset}`);
  text = text.replace(/__(.+?)__/g, `${colors.bold}$1${colors.reset}`);

  // Italic *text* or _text_
  text = text.replace(/\*([^*]+)\*/g, `${colors.italic}$1${colors.reset}`);
  text = text.replace(/_([^_]+)_/g, `${colors.italic}$1${colors.reset}`);

  // Inline code `text`
  text = text.replace(/`([^`]+)`/g, `${colors.bgMagenta}${colors.white}$1${colors.reset}`);

  // Links [text](url) - show text with underline
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, `${colors.underline}${colors.blue}$1${colors.reset}`);

  // Strikethrough ~~text~~
  text = text.replace(/~~(.+?)~~/g, `${colors.dim}$1${colors.reset}`);

  return text;
}

/**
 * Strip markdown formatting to get plain text
 */
export function stripMarkdown(text: string): string {
  // Remove code blocks
  text = text.replace(/```[\s\S]*?```/g, '');

  // Remove inline code
  text = text.replace(/`([^`]+)`/g, '$1');

  // Remove headers markers
  text = text.replace(/^#{1,6}\s+/gm, '');

  // Remove bold/italic
  text = text.replace(/\*\*(.+?)\*\*/g, '$1');
  text = text.replace(/__(.+?)__/g, '$1');
  text = text.replace(/\*([^*]+)\*/g, '$1');
  text = text.replace(/_([^_]+)_/g, '$1');

  // Remove links but keep text
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

  // Remove strikethrough
  text = text.replace(/~~(.+?)~~/g, '$1');

  // Remove blockquote markers
  text = text.replace(/^>\s?/gm, '');

  // Remove list markers
  text = text.replace(/^\s*[-*+]\s/gm, '');
  text = text.replace(/^\s*\d+\.\s/gm, '');

  // Remove horizontal rules
  text = text.replace(/^[-*_]{3,}$/gm, '');

  return text.trim();
}

/**
 * Truncate text to fit width, preserving ANSI codes
 */
export function truncateWithAnsi(text: string, maxWidth: number): string {
  // ANSI escape code regex
  const ansiRegex = /\x1b\[[0-9;]*m/g;

  let visibleLength = 0;
  let result = '';
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  // Track open ANSI codes to properly close them
  const openCodes: string[] = [];

  while ((match = ansiRegex.exec(text)) !== null) {
    // Add text before this ANSI code
    const textBefore = text.slice(lastIndex, match.index);
    const remainingSpace = maxWidth - visibleLength;

    if (textBefore.length <= remainingSpace) {
      result += textBefore;
      visibleLength += textBefore.length;
    } else {
      result += textBefore.slice(0, remainingSpace - 1) + '…';
      // Close any open ANSI codes
      if (openCodes.length > 0) {
        result += colors.reset;
      }
      return result;
    }

    // Add the ANSI code
    result += match[0];

    // Track open/close codes
    if (match[0] === colors.reset) {
      openCodes.length = 0;
    } else {
      openCodes.push(match[0]);
    }

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text
  const remainingText = text.slice(lastIndex);
  const remainingSpace = maxWidth - visibleLength;

  if (remainingText.length <= remainingSpace) {
    result += remainingText;
  } else {
    result += remainingText.slice(0, remainingSpace - 1) + '…';
  }

  // Close any open ANSI codes
  if (openCodes.length > 0) {
    result += colors.reset;
  }

  return result;
}

/**
 * Word wrap text while preserving ANSI codes
 */
export function wrapText(text: string, width: number): string[] {
  const words = text.split(/(\s+)/);
  const lines: string[] = [];
  let currentLine = '';
  let currentLength = 0;

  // ANSI escape code regex
  const ansiRegex = /\x1b\[[0-9;]*m/g;

  for (const word of words) {
    // Calculate visible length (excluding ANSI codes)
    const visibleLength = word.replace(ansiRegex, '').length;

    if (currentLength + visibleLength > width && currentLine.length > 0) {
      lines.push(currentLine.trimEnd());
      currentLine = '';
      currentLength = 0;
    }

    currentLine += word;
    currentLength += visibleLength;
  }

  if (currentLine.length > 0) {
    lines.push(currentLine.trimEnd());
  }

  return lines;
}
