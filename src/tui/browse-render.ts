/**
 * Rendering functions for the Lore Document Browser TUI
 *
 * Functions for formatting and rendering content to the UI.
 */

import { existsSync, readFileSync } from 'fs';
import path from 'path';
import os from 'os';

import type { SourceItem, BrowserState, UIComponents } from './browse-types.js';
import { emojiReplacements } from './browse-types.js';
import type { SourceType } from '../core/types.js';

// Daemon status file path
const STATUS_FILE = path.join(os.homedir(), '.config', 'lore', 'daemon.status.json');

interface DaemonStatus {
  pid: number;
  started_at: string;
  last_sync?: string;
  last_sync_result?: {
    files_scanned: number;
    files_processed: number;
    errors: number;
  };
}

/**
 * Check if daemon is running and get its status
 */
function getDaemonStatus(): { running: boolean; lastSync?: string } {
  if (!existsSync(STATUS_FILE)) {
    return { running: false };
  }

  try {
    const status: DaemonStatus = JSON.parse(readFileSync(STATUS_FILE, 'utf-8'));

    // Check if the process is still running
    try {
      process.kill(status.pid, 0);
      // Process exists
      return {
        running: true,
        lastSync: status.last_sync,
      };
    } catch {
      // Process not running
      return { running: false };
    }
  } catch {
    return { running: false };
  }
}

/**
 * Format relative time for daemon status
 */
function formatSyncTime(isoTime: string): string {
  const ms = Date.now() - new Date(isoTime).getTime();
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

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

/**
 * Update the status bar
 */
export function updateStatus(
  ui: UIComponents,
  state: BrowserState,
  project?: string,
  sourceType?: SourceType
): void {
  const count = state.filtered.length;
  const label = 'document';
  // Display user-friendly names for special project values
  let projectDisplay = project;
  if (project === '__unassigned__') {
    projectDisplay = 'Unassigned';
  } else if (project === '__all__') {
    projectDisplay = undefined; // Don't show when viewing all
  }
  const projectInfo = projectDisplay ? ` · ${projectDisplay}` : '';
  const typeInfo = sourceType ? ` · ${sourceType}` : '';
  const searchInfo = state.searchQuery ? ` · ${state.searchMode}: "${state.searchQuery}"` : '';

  // Check daemon status
  const daemon = getDaemonStatus();
  let daemonInfo = '';
  if (daemon.running) {
    const syncTime = daemon.lastSync ? formatSyncTime(daemon.lastSync) : 'starting';
    daemonInfo = ` · sync: ${syncTime}`;
  } else {
    daemonInfo = ' · [daemon off]';
  }

  ui.statusBar.setContent(` ${count} ${label}${count !== 1 ? 's' : ''}${projectInfo}${typeInfo}${searchInfo}${daemonInfo}`);
}

/**
 * Render the document list
 */
export function renderList(ui: UIComponents, state: BrowserState): void {
  const width = (ui.listContent.width as number) - 2;
  const height = (ui.listContent.height as number) - 1;
  const lines: string[] = [];

  if (state.filtered.length === 0) {
    lines.push('');
    lines.push('{blue-fg}  No documents found{/blue-fg}');
    lines.push('');
    if (state.searchQuery) {
      lines.push('{blue-fg}  Try a different search{/blue-fg}');
      lines.push('{blue-fg}  Press Esc to clear filter{/blue-fg}');
    } else {
      lines.push('{blue-fg}  Run "lore sync" to import documents{/blue-fg}');
    }
    ui.listContent.setContent(lines.join('\n'));
    return;
  }

  // Each item takes 3 lines (title, meta, spacing) or 4 with score
  const linesPerItem = 3;
  const itemsVisible = Math.floor(height / linesPerItem);

  // Keep selected item visible, but maximize items shown
  let visibleStart = 0;
  if (state.selectedIndex >= itemsVisible) {
    visibleStart = state.selectedIndex - itemsVisible + 1;
  }
  const visibleEnd = Math.min(state.filtered.length, visibleStart + itemsVisible);

  for (let i = visibleStart; i < visibleEnd; i++) {
    const source = state.filtered[i];
    const isSelected = i === state.selectedIndex;
    const date = formatDate(source.created_at);
    const contentType = source.content_type || 'document';
    const project = source.projects[0] || '';

    // Build metadata string
    const meta = `${date}  ·  ${contentType}${project ? `  ·  ${project}` : ''}`;
    const title = truncate(source.title, width - 4);
    const metaTrunc = truncate(meta, width - 6);

    // Use consistent layout - only the accent bar changes
    const accent = isSelected ? '{cyan-fg}▌{/cyan-fg}' : ' ';

    lines.push(`${accent} {bold}${title}{/bold}`);
    lines.push(`${accent}   {cyan-fg}${metaTrunc}{/cyan-fg}`);

    // Show relevance score if from semantic search
    if (source.score !== undefined) {
      const pct = Math.round(source.score * 100);
      const filled = Math.round(pct / 10);
      const bar = '●'.repeat(filled) + '○'.repeat(10 - filled);
      lines.push(`${accent}   {cyan-fg}${bar} ${pct}%{/cyan-fg}`);
    }

    // Spacing between items
    lines.push('');
  }

  ui.listContent.setContent(lines.join('\n'));
}

/**
 * Render the preview pane
 */
export function renderPreview(ui: UIComponents, state: BrowserState): void {
  if (state.filtered.length === 0) {
    ui.previewContent.setContent('{blue-fg}No documents{/blue-fg}');
    return;
  }

  const source = state.filtered[state.selectedIndex];
  if (!source) return;

  const lines: string[] = [];
  const previewWidth = (ui.previewContent.width as number) - 2;

  // Title
  lines.push(`{bold}${truncate(source.title, previewWidth)}{/bold}`);
  lines.push('');

  // Metadata
  const date = formatDate(source.created_at);
  const type = source.content_type || source.source_type;
  const project = source.projects[0] || '';

  lines.push(`{cyan-fg}${date}  ·  ${type}${project ? `  ·  ${project}` : ''}{/cyan-fg}`);

  // Show similarity score if from search
  if (source.score !== undefined) {
    const pct = Math.round(source.score * 100);
    const filled = Math.round(pct / 10);
    const bar = '●'.repeat(filled) + '○'.repeat(10 - filled);
    lines.push(`{cyan-fg}${bar} ${pct}% match{/cyan-fg}`);
  }

  lines.push('');
  lines.push('{cyan-fg}─────────────────────────────────{/cyan-fg}');
  lines.push('');

  // Summary with word wrap
  const words = source.summary.split(' ');
  let currentLine = '';

  for (const word of words) {
    if (currentLine.length + word.length + 1 > previewWidth) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = currentLine ? `${currentLine} ${word}` : word;
    }
  }
  if (currentLine) lines.push(currentLine);

  lines.push('');
  lines.push('{cyan-fg}Press Enter to view full document{/cyan-fg}');

  ui.previewContent.setContent(lines.join('\n'));
}

function highlightMatchesInLine(rawLine: string, pattern: string, isCurrentMatch: boolean): string {
  try {
    const regex = new RegExp(`(${pattern})`, 'gi');
    const highlightTag = isCurrentMatch
      ? '{yellow-bg}{black-fg}'
      : '{cyan-bg}{black-fg}';
    const closeTag = isCurrentMatch
      ? '{/black-fg}{/yellow-bg}'
      : '{/black-fg}{/cyan-bg}';

    // Escape the line for blessed first
    let escaped = escapeForBlessed(rawLine);

    // Then apply highlights to the escaped content
    // We need to match on the original escaped text
    escaped = escaped.replace(regex, `${highlightTag}$1${closeTag}`);

    return escaped;
  } catch {
    return escapeForBlessed(rawLine);
  }
}

/**
 * Build scrollbar content as a vertical string
 */
function buildScrollbarContent(
  visibleHeight: number,
  totalLines: number,
  scrollOffset: number
): string {
  // If content fits in view, no scrollbar needed
  if (totalLines <= visibleHeight) {
    return '';
  }

  // Calculate thumb size (minimum 1 line)
  const thumbSize = Math.max(1, Math.round((visibleHeight / totalLines) * visibleHeight));

  // Calculate thumb position
  const maxScroll = totalLines - visibleHeight;
  const scrollRatio = maxScroll > 0 ? scrollOffset / maxScroll : 0;
  const thumbStart = Math.round(scrollRatio * (visibleHeight - thumbSize));
  const thumbEnd = thumbStart + thumbSize;

  // Build scrollbar as array of lines
  const lines: string[] = [];
  for (let i = 0; i < visibleHeight; i++) {
    if (i >= thumbStart && i < thumbEnd) {
      lines.push('{blue-fg}█{/blue-fg}'); // Thumb
    } else {
      lines.push('{blue-fg}│{/blue-fg}'); // Track
    }
  }
  return lines.join('\n');
}

/**
 * Render the full view pane
 */
export function renderFullView(ui: UIComponents, state: BrowserState): void {
  // Update title header with document info
  const source = state.filtered[state.selectedIndex];
  if (source) {
    const date = formatDate(source.created_at);
    const type = source.content_type || source.source_type;
    const project = source.projects[0] || '';
    const titleWidth = (ui.fullViewTitle.width as number) - 2;

    const titleLines: string[] = [];
    titleLines.push(`{bold}${truncate(source.title, titleWidth)}{/bold}`);
    titleLines.push(`{cyan-fg}${date}  ·  ${type}${project ? `  ·  ${project}` : ''}{/cyan-fg}`);
    titleLines.push('{blue-fg}' + '─'.repeat(Math.min(50, titleWidth)) + '{/blue-fg}');
    ui.fullViewTitle.setContent(titleLines.join('\n'));
  }

  const height = (ui.fullViewContent.height as number) - 1;

  // Get visible line range
  const startLine = state.scrollOffset;
  const endLine = Math.min(startLine + height, state.fullContentLines.length);
  const totalLines = state.fullContentLines.length;

  const visible: string[] = [];

  for (let lineIndex = 0; lineIndex < endLine - startLine; lineIndex++) {
    const lineNum = startLine + lineIndex;
    const isMatchLine = state.docSearchMatches.includes(lineNum);
    const isCurrentMatch = state.docSearchMatches[state.docSearchCurrentIdx] === lineNum;

    let lineContent: string;
    if (state.docSearchPattern && isMatchLine) {
      // Get raw line and highlight matches within it
      const rawLine = state.fullContentLinesRaw[lineNum] || '';
      lineContent = highlightMatchesInLine(rawLine, state.docSearchPattern, isCurrentMatch);
    } else {
      // No search or non-matching line - render normally
      lineContent = state.fullContentLines[lineNum];
    }

    visible.push(lineContent);
  }

  ui.fullViewContent.setContent(visible.join('\n'));

  // Update scrollbar (separate element on right edge)
  const scrollbarContent = buildScrollbarContent(height, totalLines, state.scrollOffset);
  ui.fullViewScrollbar.setContent(scrollbarContent);
  // Show/hide scrollbar based on whether content is scrollable
  if (totalLines > height) {
    ui.fullViewScrollbar.show();
  } else {
    ui.fullViewScrollbar.hide();
  }

  // Update footer for full view mode with scroll position
  const currentLine = state.scrollOffset + 1;
  const lastVisibleLine = Math.min(state.scrollOffset + height, totalLines);
  const positionInfo = totalLines > height ? `{cyan-fg}${currentLine}-${lastVisibleLine}/${totalLines}{/cyan-fg} ` : '';

  let footerText = ` ${positionInfo}j/k: scroll  /: search  e: editor  Esc: back  q: quit`;
  if (state.docSearchPattern && state.docSearchMatches.length > 0) {
    footerText = ` ${positionInfo}[${state.docSearchCurrentIdx + 1}/${state.docSearchMatches.length}] n/N: next/prev  /: new search  Esc: clear`;
  } else if (state.docSearchPattern && state.docSearchMatches.length === 0) {
    footerText = ` ${positionInfo}No matches for "${state.docSearchPattern}"  /: new search  Esc: clear`;
  }
  ui.footer.setContent(footerText);
  ui.screen.render();
}
