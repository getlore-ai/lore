/**
 * Browse Render - Utils
 *
 * Pure formatting/escaping utilities for the TUI renderer.
 */

import { emojiReplacements } from './browse-types.js';

/**
 * Format a date for display
 */
export function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;

  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * Truncate a string to a maximum length
 */
export function truncate(str: string, len: number): string {
  if (str.length <= len) return str;
  return str.slice(0, len - 1) + '…';
}

/**
 * Escape text for blessed tags - must escape curly braces and handle special chars
 */
export function escapeForBlessed(text: string): string {
  let result = text;

  // Replace known emojis with ASCII equivalents
  for (const [emoji, replacement] of Object.entries(emojiReplacements)) {
    result = result.split(emoji).join(replacement);
  }

  return result
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/\t/g, '    ')  // Replace tabs with spaces
    // Remove any remaining emojis (fallback)
    .replace(/[\u{1F300}-\u{1F9FF}]/gu, '')  // Misc symbols, emoticons, etc.
    .replace(/[\u{2600}-\u{26FF}]/gu, '')    // Misc symbols
    .replace(/[\u{2700}-\u{27BF}]/gu, '')    // Dingbats
    .replace(/[\u{FE00}-\u{FE0F}]/gu, '')    // Variation selectors
    .replace(/[\u{1F000}-\u{1F02F}]/gu, '')  // Mahjong, dominos
    .replace(/[\u{1F0A0}-\u{1F0FF}]/gu, ''); // Playing cards
}

/**
 * Format relative time for picker/status displays (compact form)
 */
export function formatRelativeTime(isoTime: string): string {
  const date = new Date(isoTime);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'today';
  if (diffDays === 1) return '1d ago';
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`;
  return `${Math.floor(diffDays / 365)}y ago`;
}

/**
 * Format value as JSON for preview display
 */
export function formatJsonForPreview(value: unknown): string {
  try {
    if (typeof value === 'string') {
      return value;
    }
    return JSON.stringify(value ?? null, null, 2) || '';
  } catch (error) {
    return `JSON error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/**
 * Simple markdown to blessed tags converter (no ANSI codes)
 */
export function markdownToBlessed(text: string): string {
  const lines = text.split('\n');
  const result: string[] = [];

  for (const line of lines) {
    let processed = line;

    // Escape first to protect content
    processed = escapeForBlessed(processed);

    // Headers (must check longer patterns first)
    if (processed.startsWith('### ')) {
      result.push(`{bold}{cyan-fg}${processed.slice(4)}{/cyan-fg}{/bold}`);
      continue;
    }
    if (processed.startsWith('## ')) {
      result.push('');
      result.push(`{bold}{blue-fg}${processed.slice(3)}{/blue-fg}{/bold}`);
      continue;
    }
    if (processed.startsWith('# ')) {
      result.push('');
      result.push(`{bold}{cyan-fg}${processed.slice(2)}{/cyan-fg}{/bold}`);
      continue;
    }

    // Blockquotes
    if (processed.startsWith('> ')) {
      result.push(`{blue-fg}│{/blue-fg} {italic}${processed.slice(2)}{/italic}`);
      continue;
    }

    // List items
    if (processed.match(/^\s*[-*]\s/)) {
      processed = processed.replace(/^(\s*)[-*]\s/, '$1{yellow-fg}•{/yellow-fg} ');
    }

    // Bold **text**
    processed = processed.replace(/\*\*([^*]+)\*\*/g, '{bold}$1{/bold}');

    // Italic *text*
    processed = processed.replace(/\*([^*]+)\*/g, '{italic}$1{/italic}');

    // Inline code `text`
    processed = processed.replace(/`([^`]+)`/g, '{magenta-fg}$1{/magenta-fg}');

    result.push(processed);
  }

  return result.join('\n');
}
