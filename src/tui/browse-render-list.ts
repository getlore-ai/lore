/**
 * Browse Render - List
 *
 * Status bar, list building, source selection, and list rendering
 * (flat and grouped views).
 */

import { existsSync, readFileSync } from 'fs';
import path from 'path';
import os from 'os';

import type { SourceItem, BrowserState, UIComponents, ListItem } from './browse-types.js';
import type { SourceType } from '../core/types.js';
import { formatDate, truncate } from './browse-render-utils.js';

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
 * Update the status bar
 */
export function updateStatus(
  ui: UIComponents,
  state: BrowserState,
  project?: string,
  sourceType?: SourceType
): void {
  const count = state.filtered.length;
  const label = state.showLogs ? 'log' : 'document';
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

  const logsInfo = state.showLogs ? ' · {yellow-fg}[LOGS]{/yellow-fg}' : '';
  ui.statusBar.setContent(` ${count} ${label}${count !== 1 ? 's' : ''}${groupInfo}${projectInfo}${contentTypeInfo}${typeInfo}${logsInfo}${searchInfo}${daemonInfo}${userInfo}`);
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

  // In log mode, include all known projects (even those with 0 logs)
  if (state.showLogs && state.projects.length > 0) {
    for (const p of state.projects) {
      // Skip sentinel values from the project picker
      if (p.name === '__all__' || p.name === '__unassigned__') continue;
      if (!byProject.has(p.name)) {
        byProject.set(p.name, []);
      }
    }
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
  const height = ui.listContent.height as number;
  const lines: string[] = [];

  if (state.filtered.length === 0) {
    // In log mode with grouped view, still show project headers (even with 0 logs)
    if (state.showLogs && state.groupByProject && state.projects.length > 0) {
      state.listItems = buildListItems(state);
      if (state.listItems.length > 0) {
        renderGroupedList(ui, state, width, height, lines);
        ui.listContent.setContent(lines.join('\n'));
        return;
      }
    }

    const emptyLabel = state.showLogs ? 'No log entries found' : 'No documents found';
    lines.push('');
    lines.push(`{blue-fg}  ${emptyLabel}{/blue-fg}`);
    lines.push('');
    if (state.searchQuery) {
      lines.push('{blue-fg}  Try a different search{/blue-fg}');
      lines.push('{blue-fg}  Press Esc to clear filter{/blue-fg}');
    } else if (state.showLogs) {
      lines.push('{blue-fg}  Use the log MCP tool to add entries{/blue-fg}');
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

  // Render items until we fill the viewport
  let linesUsed = 0;
  for (let i = visibleStart; i < state.filtered.length; i++) {
    if (linesUsed + linesPerItem > height) break;
    linesUsed += linesPerItem;

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
  // Calculate line height for each item type
  const itemLineHeight = (i: number) => state.listItems[i]?.type === 'header' ? 2 : 3;

  // Find visibleStart: scroll so selectedIndex is visible
  let visibleStart = 0;
  // Count lines from visibleStart to selectedIndex (inclusive)
  let linesFromStartToSelected = 0;
  for (let i = 0; i <= state.selectedIndex; i++) {
    linesFromStartToSelected += itemLineHeight(i);
  }
  // If selectedIndex doesn't fit, scroll forward
  while (linesFromStartToSelected > height && visibleStart < state.selectedIndex) {
    linesFromStartToSelected -= itemLineHeight(visibleStart);
    visibleStart++;
  }

  // Render items until we fill the viewport
  let linesUsed = 0;
  for (let i = visibleStart; i < state.listItems.length; i++) {
    const h = itemLineHeight(i);
    if (linesUsed + h > height) break;
    linesUsed += h;

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
  const date = formatDate(source.indexed_at || source.created_at);
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
