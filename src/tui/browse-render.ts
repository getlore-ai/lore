/**
 * Rendering functions for the Lore Document Browser TUI
 *
 * Functions for formatting and rendering content to the UI.
 */

import { existsSync, readFileSync } from 'fs';
import path from 'path';
import os from 'os';

import type { SourceItem, BrowserState, UIComponents, ListItem } from './browse-types.js';
import { emojiReplacements } from './browse-types.js';
import type { SourceType } from '../core/types.js';

// Daemon status file path
const CONFIG_DIR = path.join(os.homedir(), '.config', 'lore');
const STATUS_FILE = path.join(CONFIG_DIR, 'daemon.status.json');
const AUTH_FILE = path.join(CONFIG_DIR, 'auth.json');

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
 * Get the currently signed-in user's email (if any)
 */
function getAuthUser(): string | null {
  if (process.env.SUPABASE_SERVICE_KEY) {
    return '[service key]';
  }

  if (!existsSync(AUTH_FILE)) {
    return null;
  }

  try {
    const auth = JSON.parse(readFileSync(AUTH_FILE, 'utf-8'));
    return auth?.user?.email || null;
  } catch {
    return null;
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
  const contentTypeInfo = state.currentContentType ? ` · type:${state.currentContentType}` : '';
  const searchInfo = state.searchQuery ? ` · ${state.searchMode}: "${state.searchQuery}"` : '';

  // Count unique projects in grouped view
  let groupInfo = '';
  if (state.groupByProject && state.listItems.length > 0) {
    const projectCount = state.listItems.filter(i => i.type === 'header').length;
    groupInfo = ` in ${projectCount} project${projectCount !== 1 ? 's' : ''}`;
  }

  // Check daemon status
  const daemon = getDaemonStatus();
  let daemonInfo = '';
  if (daemon.running) {
    const syncTime = daemon.lastSync ? formatSyncTime(daemon.lastSync) : 'starting';
    daemonInfo = ` · sync: ${syncTime}`;
  } else {
    daemonInfo = ' · [daemon off]';
  }

  // Show signed-in user
  const authUser = getAuthUser();
  const userInfo = authUser ? ` · ${authUser}` : ' · [not signed in]';

  ui.statusBar.setContent(` ${count} ${label}${count !== 1 ? 's' : ''}${groupInfo}${projectInfo}${contentTypeInfo}${typeInfo}${searchInfo}${daemonInfo}${userInfo}`);
}

/**
 * Build flattened list items from grouped sources
 */
export function buildListItems(state: BrowserState): ListItem[] {
  if (!state.groupByProject) {
    // Flat view - just wrap documents
    return state.filtered.map(source => ({
      type: 'document' as const,
      source,
      projectName: source.projects[0] || '__unassigned__',
    }));
  }

  // Group documents by project
  const byProject = new Map<string, SourceItem[]>();

  for (const source of state.filtered) {
    const projectName = source.projects[0] || '__unassigned__';
    if (!byProject.has(projectName)) {
      byProject.set(projectName, []);
    }
    byProject.get(projectName)!.push(source);
  }

  // Sort projects alphabetically, but put __unassigned__ at the end
  const projectNames = Array.from(byProject.keys()).sort((a, b) => {
    if (a === '__unassigned__') return 1;
    if (b === '__unassigned__') return -1;
    return a.localeCompare(b);
  });

  // Build flattened list
  const items: ListItem[] = [];

  for (const projectName of projectNames) {
    const docs = byProject.get(projectName)!;
    const expanded = state.expandedProjects.has(projectName);
    const displayName = projectName === '__unassigned__' ? 'Unassigned' : projectName;

    // Add header
    items.push({
      type: 'header',
      projectName,
      displayName,
      documentCount: docs.length,
      expanded,
    });

    // Add documents if expanded
    if (expanded) {
      for (const source of docs) {
        items.push({
          type: 'document',
          source,
          projectName,
        });
      }
    }
  }

  return items;
}

/**
 * Get the currently selected source (if any)
 */
export function getSelectedSource(state: BrowserState): SourceItem | null {
  if (!state.groupByProject) {
    return state.filtered[state.selectedIndex] || null;
  }

  const item = state.listItems[state.selectedIndex];
  if (item && item.type === 'document') {
    return item.source;
  }
  return null;
}

/**
 * Render the document list (supports both flat and grouped views)
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

  // Rebuild list items if in grouped mode
  if (state.groupByProject) {
    state.listItems = buildListItems(state);
  }

  // Use grouped view if enabled
  if (state.groupByProject && state.listItems.length > 0) {
    renderGroupedList(ui, state, width, height, lines);
  } else {
    renderFlatList(ui, state, width, height, lines);
  }

  ui.listContent.setContent(lines.join('\n'));
}

/**
 * Render flat list (original behavior)
 */
function renderFlatList(
  ui: UIComponents,
  state: BrowserState,
  width: number,
  height: number,
  lines: string[]
): void {
  const linesPerItem = 3;
  const itemsVisible = Math.floor(height / linesPerItem);

  let visibleStart = 0;
  if (state.selectedIndex >= itemsVisible) {
    visibleStart = state.selectedIndex - itemsVisible + 1;
  }
  const visibleEnd = Math.min(state.filtered.length, visibleStart + itemsVisible);

  for (let i = visibleStart; i < visibleEnd; i++) {
    const source = state.filtered[i];
    const isSelected = i === state.selectedIndex;
    renderDocumentItem(source, isSelected, width, lines, true);
  }
}

/**
 * Render grouped list with collapsible project folders
 */
function renderGroupedList(
  ui: UIComponents,
  state: BrowserState,
  width: number,
  height: number,
  lines: string[]
): void {
  // Calculate lines per item (headers take 2, docs take 3)
  const avgLinesPerItem = 2.5;
  const itemsVisible = Math.floor(height / avgLinesPerItem);

  let visibleStart = 0;
  if (state.selectedIndex >= itemsVisible) {
    visibleStart = state.selectedIndex - itemsVisible + 1;
  }
  const visibleEnd = Math.min(state.listItems.length, visibleStart + itemsVisible);

  for (let i = visibleStart; i < visibleEnd; i++) {
    const item = state.listItems[i];
    const isSelected = i === state.selectedIndex;

    if (item.type === 'header') {
      renderProjectHeader(item, isSelected, width, lines);
    } else {
      renderDocumentItem(item.source, isSelected, width, lines, false);
    }
  }
}

/**
 * Render a project header row
 */
function renderProjectHeader(
  item: Extract<ListItem, { type: 'header' }>,
  isSelected: boolean,
  width: number,
  lines: string[]
): void {
  const icon = item.expanded ? '▼' : '▶';
  const countStr = `(${item.documentCount})`;
  const name = truncate(item.displayName, width - 10);

  if (isSelected) {
    lines.push(`{inverse}{yellow-fg} ${icon} ${name} {cyan-fg}${countStr}{/cyan-fg} {/yellow-fg}{/inverse}`);
  } else {
    lines.push(`{yellow-fg} ${icon} ${name}{/yellow-fg} {cyan-fg}${countStr}{/cyan-fg}`);
  }
  lines.push('');
}

/**
 * Render a document item row
 */
function renderDocumentItem(
  source: SourceItem,
  isSelected: boolean,
  width: number,
  lines: string[],
  showProject: boolean
): void {
  const date = formatDate(source.created_at);
  const contentType = source.content_type || 'document';
  const project = source.projects[0] || '';

  // Format content type as a tag
  const typeTag = `[${contentType}]`;

  // Build metadata string (don't show project in grouped view)
  const meta = showProject
    ? `${date}  {yellow-fg}${typeTag}{/yellow-fg}${project ? `  ${project}` : ''}`
    : `${date}  {yellow-fg}${typeTag}{/yellow-fg}`;

  const indent = showProject ? '' : '  '; // Indent docs under headers
  const title = truncate(source.title, width - 4 - indent.length);
  const metaTrunc = truncate(meta, width - 6 - indent.length);

  const accent = isSelected ? '{cyan-fg}▌{/cyan-fg}' : ' ';

  lines.push(`${accent}${indent} {bold}${title}{/bold}`);
  lines.push(`${accent}${indent}   {cyan-fg}${metaTrunc}{/cyan-fg}`);

  // Show relevance score if from semantic search
  if (source.score !== undefined) {
    const pct = Math.round(source.score * 100);
    const filled = Math.round(pct / 10);
    const bar = '●'.repeat(filled) + '○'.repeat(10 - filled);
    lines.push(`${accent}${indent}   {cyan-fg}${bar} ${pct}%{/cyan-fg}`);
  }

  lines.push('');
}

/**
 * Render the preview pane
 */
export function renderPreview(ui: UIComponents, state: BrowserState): void {
  if (state.filtered.length === 0) {
    ui.previewContent.setContent('{blue-fg}No documents{/blue-fg}');
    return;
  }

  const lines: string[] = [];
  const previewWidth = (ui.previewContent.width as number) - 2;

  // Handle grouped view
  if (state.groupByProject && state.listItems.length > 0) {
    const item = state.listItems[state.selectedIndex];

    if (!item) {
      ui.previewContent.setContent('{blue-fg}No selection{/blue-fg}');
      return;
    }

    if (item.type === 'header') {
      // Show project info
      lines.push(`{bold}{yellow-fg}${item.displayName}{/yellow-fg}{/bold}`);
      lines.push('');
      lines.push(`{cyan-fg}${item.documentCount} document${item.documentCount !== 1 ? 's' : ''}{/cyan-fg}`);
      lines.push('');
      lines.push('{cyan-fg}─────────────────────────────────{/cyan-fg}');
      lines.push('');
      if (item.expanded) {
        lines.push('{blue-fg}Press Space to collapse{/blue-fg}');
      } else {
        lines.push('{blue-fg}Press Space to expand{/blue-fg}');
      }
      ui.previewContent.setContent(lines.join('\n'));
      return;
    }

    // It's a document
    renderDocumentPreview(item.source, previewWidth, lines);
    ui.previewContent.setContent(lines.join('\n'));
    return;
  }

  // Flat view
  const source = state.filtered[state.selectedIndex];
  if (!source) return;

  renderDocumentPreview(source, previewWidth, lines);
  ui.previewContent.setContent(lines.join('\n'));
}

/**
 * Render document preview content
 */
function renderDocumentPreview(source: SourceItem, previewWidth: number, lines: string[]): void {
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
