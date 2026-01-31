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

  ui.statusBar.setContent(` ${count} document${count !== 1 ? 's' : ''}${projectInfo}${typeInfo}${searchInfo}${daemonInfo}`);
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

  const visibleStart = Math.max(0, state.selectedIndex - Math.floor(height / 2));
  const visibleEnd = Math.min(state.filtered.length, visibleStart + height);

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

function formatJsonForPreview(value: unknown): string {
  try {
    if (typeof value === 'string') {
      return value;
    }
    return JSON.stringify(value ?? null, null, 2) || '';
  } catch (error) {
    return `JSON error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function formatToolFormValue(fieldType: 'string' | 'number' | 'boolean', value: unknown): string {
  if (fieldType === 'boolean') {
    return value ? '[x]' : '[ ]';
  }
  const text = value === undefined || value === null ? '' : String(value);
  return `[${escapeForBlessed(text)}]`;
}

/**
 * Render the tool form overlay
 */
export function renderToolForm(ui: UIComponents, state: BrowserState): void {
  const width = (ui.toolFormContent.width as number) - 2;
  const lines: string[] = [];

  if (state.toolFormFields.length === 0) {
    lines.push('{blue-fg}No input fields for this tool.{/blue-fg}');
    lines.push('');
    lines.push('{blue-fg}[Enter: run]  [Esc: back]{/blue-fg}');
    ui.toolFormContent.setContent(lines.join('\n'));
    return;
  }

  for (let i = 0; i < state.toolFormFields.length; i++) {
    const field = state.toolFormFields[i];
    const isFocused = i === state.toolFormIndex;
    const name = escapeForBlessed(field.name);
    const reqLabel = field.required ? '{red-fg}(required){/red-fg}' : '{green-fg}(optional){/green-fg}';
    const valueText = formatToolFormValue(field.type, field.value);
    const line = truncate(`${name}: ${valueText} ${reqLabel}`, width);
    lines.push(isFocused ? `{inverse}${line}{/inverse}` : line);

    if (field.description) {
      const hint = truncate(escapeForBlessed(field.description), Math.max(0, width - 2));
      lines.push(`  {blue-fg}${hint}{/blue-fg}`);
    }
    lines.push('');
  }

  lines.push('{blue-fg}[Tab: next field]  [Shift+Tab: prev]  [Enter: run]  [Esc: back]{/blue-fg}');

  ui.toolFormContent.setContent(lines.join('\n'));
}

/**
 * Render the tools list
 */
export function renderToolsList(ui: UIComponents, state: BrowserState): void {
  const width = (ui.listContent.width as number) - 2;
  const height = (ui.listContent.height as number) - 1;
  const lines: string[] = [];

  if (state.toolsList.length === 0) {
    lines.push('');
    lines.push('{blue-fg}  No tools available{/blue-fg}');
    lines.push('');
    lines.push('{blue-fg}  Install extensions with tools{/blue-fg}');
    ui.listContent.setContent(lines.join('\n'));
    return;
  }

  const visibleStart = Math.max(0, state.selectedToolIndex - Math.floor(height / 3));
  const visibleEnd = Math.min(state.toolsList.length, visibleStart + height);

  for (let i = visibleStart; i < visibleEnd; i++) {
    const tool = state.toolsList[i];
    const isSelected = i === state.selectedToolIndex;
    const accent = isSelected ? '{cyan-fg}▌{/cyan-fg}' : ' ';

    const name = truncate(tool.name, width - 4);
    const description = truncate(tool.description || '', width - 6);

    lines.push(`${accent} {bold}${escapeForBlessed(name)}{/bold}`);
    if (description) {
      lines.push(`${accent}   {cyan-fg}${escapeForBlessed(description)}{/cyan-fg}`);
    }
    lines.push('');
  }

  ui.listContent.setContent(lines.join('\n'));
}

/**
 * Format tool result in a human-readable way
 */
function formatToolResultNicely(result: unknown, maxWidth: number): string[] {
  const lines: string[] = [];
  
  if (result === null || result === undefined) {
    lines.push('{blue-fg}(no result){/blue-fg}');
    return lines;
  }
  
  if (typeof result !== 'object') {
    lines.push(escapeForBlessed(String(result)));
    return lines;
  }
  
  const obj = result as Record<string, unknown>;
  
  // Handle common patterns
  if ('status' in obj && obj.status === 'ok') {
    lines.push(`{green-fg}Status:{/green-fg} ${escapeForBlessed(String(obj.status))}`);
  }
  
  if ('message' in obj) {
    lines.push(`{cyan-fg}Message:{/cyan-fg} ${escapeForBlessed(String(obj.message))}`);
  }
  
  if ('total_sources_analyzed' in obj) {
    lines.push(`{cyan-fg}Sources analyzed:{/cyan-fg} ${obj.total_sources_analyzed}`);
  }
  
  if ('total_speakers' in obj) {
    lines.push(`{cyan-fg}Total speakers:{/cyan-fg} ${obj.total_speakers}`);
  }
  
  if ('top_pain_point' in obj) {
    lines.push(`{cyan-fg}Top pain point:{/cyan-fg} ${escapeForBlessed(String(obj.top_pain_point))}`);
  }
  
  if ('verdict' in obj) {
    const verdict = String(obj.verdict);
    const color = verdict === 'SUPPORTED' ? 'green' : verdict === 'CONTRADICTED' ? 'red' : 'yellow';
    lines.push(`{${color}-fg}Verdict:{/${color}-fg} ${verdict}`);
  }
  
  if ('confidence' in obj) {
    lines.push(`{cyan-fg}Confidence:{/cyan-fg} ${escapeForBlessed(String(obj.confidence))}`);
  }
  
  if ('coverage_note' in obj && obj.coverage_note) {
    lines.push('');
    lines.push(`{yellow-fg}⚠ ${escapeForBlessed(String(obj.coverage_note))}{/yellow-fg}`);
  }
  
  if ('features_tested' in obj && Array.isArray(obj.features_tested)) {
    lines.push('');
    lines.push('{cyan-fg}Features tested:{/cyan-fg}');
    for (const feature of obj.features_tested) {
      lines.push(`  • ${escapeForBlessed(String(feature))}`);
    }
  }
  
  if ('pain_points' in obj && Array.isArray(obj.pain_points)) {
    const painPoints = obj.pain_points as Array<{ category?: string; frequency?: number }>;
    if (painPoints.length > 0) {
      lines.push('');
      lines.push('{cyan-fg}Pain points:{/cyan-fg}');
      for (const pp of painPoints.slice(0, 5)) {
        lines.push(`  • ${escapeForBlessed(pp.category || 'Unknown')} (${pp.frequency || 0}x)`);
      }
    }
  }
  
  if ('profiles' in obj && Array.isArray(obj.profiles)) {
    const profiles = obj.profiles as Array<{ name?: string; appearances?: number }>;
    if (profiles.length > 0) {
      lines.push('');
      lines.push('{cyan-fg}Speakers:{/cyan-fg}');
      for (const p of profiles.slice(0, 5)) {
        lines.push(`  • ${escapeForBlessed(p.name || 'Unknown')} (${p.appearances || 0} appearances)`);
      }
    }
  }
  
  if ('supporting' in obj && Array.isArray(obj.supporting)) {
    const supporting = obj.supporting as Array<{ source?: string }>;
    if (supporting.length > 0) {
      lines.push('');
      lines.push(`{green-fg}Supporting evidence:{/green-fg} ${supporting.length} sources`);
      for (const s of supporting.slice(0, 3)) {
        lines.push(`  • ${escapeForBlessed(s.source || 'Unknown source')}`);
      }
    }
  }
  
  if ('contradicting' in obj && Array.isArray(obj.contradicting)) {
    const contradicting = obj.contradicting as Array<{ source?: string }>;
    if (contradicting.length > 0) {
      lines.push('');
      lines.push(`{red-fg}Contradicting evidence:{/red-fg} ${contradicting.length} sources`);
      for (const c of contradicting.slice(0, 3)) {
        lines.push(`  • ${escapeForBlessed(c.source || 'Unknown source')}`);
      }
    }
  }
  
  // If we didn't format anything special, fall back to JSON
  if (lines.length === 0) {
    const jsonText = formatJsonForPreview(result);
    for (const line of jsonText.split('\n')) {
      lines.push(truncate(escapeForBlessed(line), maxWidth));
    }
  }
  
  return lines;
}

/**
 * Render the tool preview (schema + result)
 */
export function renderToolResult(ui: UIComponents, state: BrowserState): void {
  if (state.toolsList.length === 0) {
    ui.previewContent.setContent('{blue-fg}No tools{/blue-fg}');
    return;
  }

  const tool = state.toolsList[state.selectedToolIndex];
  if (!tool) {
    ui.previewContent.setContent('{blue-fg}Select a tool{/blue-fg}');
    return;
  }

  const lines: string[] = [];
  const previewWidth = (ui.previewContent.width as number) - 2;

  lines.push(`{bold}${truncate(escapeForBlessed(tool.name), previewWidth)}{/bold}`);
  if (tool.description) {
    lines.push(escapeForBlessed(tool.description));
  }

  lines.push('');
  lines.push('{cyan-fg}Input Schema{/cyan-fg}');
  lines.push('{cyan-fg}─────────────────────────────────{/cyan-fg}');
  const schemaText = formatJsonForPreview(tool.inputSchema);
  for (const line of schemaText.split('\n')) {
    lines.push(truncate(escapeForBlessed(line), previewWidth));
  }

  const matchingResult = state.toolResult && state.toolResult.toolName === tool.name
    ? state.toolResult
    : null;

  if (matchingResult) {
    lines.push('');
    if (matchingResult.ok) {
      lines.push('{green-fg}✓ Result{/green-fg}');
      lines.push('{cyan-fg}─────────────────────────────────{/cyan-fg}');
      const formattedResult = formatToolResultNicely(matchingResult.result, previewWidth);
      lines.push(...formattedResult);
    } else {
      lines.push('{red-fg}✗ Error{/red-fg}');
      lines.push('{cyan-fg}─────────────────────────────────{/cyan-fg}');
      lines.push(`{red-fg}${escapeForBlessed(String(matchingResult.result))}{/red-fg}`);
    }
  } else if (state.toolRunning) {
    lines.push('');
    lines.push('{yellow-fg}⏳ Running...{/yellow-fg}');
  } else {
    lines.push('');
    lines.push('{cyan-fg}Press Enter to run tool{/cyan-fg}');
  }

  ui.previewContent.setContent(lines.join('\n'));
}

/**
 * Highlight matches within a line by wrapping them with blessed tags
 * Works on the raw line first, then applies markdown formatting
 */
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

  const visible: string[] = [];

  for (let lineNum = startLine; lineNum < endLine; lineNum++) {
    const isMatchLine = state.docSearchMatches.includes(lineNum);
    const isCurrentMatch = state.docSearchMatches[state.docSearchCurrentIdx] === lineNum;

    if (state.docSearchPattern && isMatchLine) {
      // Get raw line and highlight matches within it
      const rawLine = state.fullContentLinesRaw[lineNum] || '';
      const highlighted = highlightMatchesInLine(rawLine, state.docSearchPattern, isCurrentMatch);
      visible.push(highlighted);
    } else {
      // No search or non-matching line - render normally
      visible.push(state.fullContentLines[lineNum]);
    }
  }

  ui.fullViewContent.setContent(visible.join('\n'));

  // Update footer for full view mode
  let footerText = ' j/k: scroll  /: search  e: editor  Esc: back  q: quit';
  if (state.docSearchPattern && state.docSearchMatches.length > 0) {
    footerText = ` [${state.docSearchCurrentIdx + 1}/${state.docSearchMatches.length}] n/N: next/prev  /: new search  Esc: clear`;
  } else if (state.docSearchPattern && state.docSearchMatches.length === 0) {
    footerText = ` No matches for "${state.docSearchPattern}"  /: new search  Esc: clear`;
  }
  ui.footer.setContent(footerText);
  ui.screen.render();
}
