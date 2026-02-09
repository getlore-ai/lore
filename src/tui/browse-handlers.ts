/**
 * Event handlers and operations for the Lore Document Browser TUI
 *
 * Contains navigation, search, editor integration, and mode switching.
 */

import { spawn } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

import type { BrowserState, UIComponents, SourceDetails, ProjectInfo } from './browse-types.js';
import {
  formatDate,
  markdownToBlessed,
  renderFullView,
  renderList,
  renderPreview,
  updateStatus,
  buildListItems,
  getSelectedSource,
} from './browse-render.js';
import { getSourceById, searchSources, getProjectStats, getAllSources, deleteSource, updateSourceProjects, updateSourceTitle, updateSourceContentType } from '../core/vector-store.js';
import { generateEmbedding } from '../core/embedder.js';
import { searchLocalFiles } from '../core/local-search.js';
import { gitCommitAndPush, deleteFileAndCommit } from '../core/git.js';
import type { SearchMode, SourceType } from '../core/types.js';

/**
 * Helper to re-render ask/research pane when returning from pickers
 * Exported so browse.ts can use it for autocomplete direct selection
 */
export function renderReturnToAskOrResearch(state: BrowserState, ui: UIComponents, mode: 'ask' | 'research'): void {
  const filters: string[] = [];
  if (state.currentProject) filters.push(`project: ${state.currentProject}`);
  if (state.currentContentType) filters.push(`type: ${state.currentContentType}`);
  const filterInfo = filters.length > 0
    ? `{yellow-fg}Scope: ${filters.join(', ')}{/yellow-fg}`
    : '{blue-fg}No filters{/blue-fg}';
  const footerNote = filters.length > 0
    ? `{yellow-fg}${filters.join(', ')}{/yellow-fg}`
    : '{blue-fg}all sources{/blue-fg}';

  if (mode === 'ask') {
    const lines = [
      `${filterInfo}  {blue-fg}│{/blue-fg}  {white-fg}/help{/white-fg} for commands  {blue-fg}│{/blue-fg}  {white-fg}/new{/white-fg} to start fresh`,
      '',
    ];
    if (state.askHistory.length > 0) {
      for (const msg of state.askHistory) {
        if (msg.role === 'user') {
          lines.push(`{cyan-fg}You:{/cyan-fg} ${msg.content}`);
        } else {
          const escaped = msg.content.replace(/\{/g, '\\{').replace(/\}/g, '\\}');
          lines.push(`{green-fg}Assistant:{/green-fg}`);
          lines.push(escaped);
        }
        lines.push('');
      }
    } else {
      lines.push('{blue-fg}Ask a question about your knowledge base...{/blue-fg}');
    }
    ui.askPane.setContent(lines.join('\n'));
    const historyNote = state.askHistory.length > 0 ? `${state.askHistory.length / 2} Q&A  │  ` : '';
    ui.footer.setContent(` ${historyNote}Enter: Send  │  Esc: Back  │  Scope: ${footerNote}`);
  } else {
    const lines = [
      `${filterInfo}  {blue-fg}│{/blue-fg}  {white-fg}/help{/white-fg} for commands  {blue-fg}│{/blue-fg}  {white-fg}/new{/white-fg} to start fresh`,
      '',
    ];
    if (state.researchHistory.length > 0) {
      for (const item of state.researchHistory) {
        lines.push(`{cyan-fg}Research:{/cyan-fg} ${item.query}`);
        lines.push('');
        const escaped = item.summary.replace(/\{/g, '\\{').replace(/\}/g, '\\}');
        lines.push(escaped);
        lines.push('');
        lines.push('{blue-fg}───────────────────────────────────────{/blue-fg}');
        lines.push('');
      }
    } else {
      lines.push('{blue-fg}Enter a research task to begin comprehensive analysis...{/blue-fg}');
      lines.push('');
      lines.push('{blue-fg}The research agent will iteratively explore sources,{/blue-fg}');
      lines.push('{blue-fg}cross-reference findings, and synthesize results.{/blue-fg}');
    }
    ui.askPane.setContent(lines.join('\n'));
    const historyNote = state.researchHistory.length > 0 ? `${state.researchHistory.length} tasks  │  ` : '';
    ui.footer.setContent(` ${historyNote}Enter: Research  │  Esc: Back  │  Scope: ${footerNote}`);
  }
}

/**
 * Load full content for the selected document
 */
export async function loadFullContent(
  state: BrowserState,
  ui: UIComponents,
  dbPath: string,
  sourcesDir: string
): Promise<void> {
  if (state.filtered.length === 0) return;

  // Get selected source (handles both grouped and flat view)
  const source = getSelectedSource(state);
  if (!source) return;

  // Try to load from disk first (content.md, then original file)
  const sourceDir = path.join(sourcesDir, source.id);
  const contentPath = path.join(sourceDir, 'content.md');

  try {
    const { readFile } = await import('fs/promises');
    state.fullContent = await readFile(contentPath, 'utf-8');
  } catch {
    // content.md not found — try to find and read an original text file
    let foundOriginal = false;
    try {
      const { readFile, readdir } = await import('fs/promises');
      const files = await readdir(sourceDir);
      const originalFile = files.find(f => f.startsWith('original.'));
      if (originalFile) {
        const textExts = ['.md', '.txt', '.json', '.jsonl', '.csv', '.xml', '.yaml', '.yml', '.html', '.log'];
        const ext = path.extname(originalFile).toLowerCase();
        if (textExts.includes(ext)) {
          state.fullContent = await readFile(path.join(sourceDir, originalFile), 'utf-8');
          foundOriginal = true;
        }
      }
    } catch {
      // Source directory doesn't exist locally — fall through to DB
    }

    if (!foundOriginal) {
      // Try reading from source_path (original file in sync directory)
      const details = await getSourceById(dbPath, source.id) as (SourceDetails & { source_path?: string }) | null;

      if (details?.source_path) {
        try {
          const { readFile } = await import('fs/promises');
          const ext = path.extname(details.source_path).toLowerCase();
          const textExts = ['.md', '.txt', '.json', '.jsonl', '.csv', '.xml', '.yaml', '.yml', '.html', '.log'];
          if (textExts.includes(ext)) {
            state.fullContent = await readFile(details.source_path, 'utf-8');
            foundOriginal = true;
          }
        } catch {
          // source_path file doesn't exist or can't be read
        }
      }

      if (!foundOriginal) {
        // Final fallback: database summary view
        if (details) {
          state.fullContent = [
            `# ${details.title}`,
            '',
            `**Type:** ${details.source_type} · ${details.content_type}`,
            `**Date:** ${formatDate(details.created_at)}`,
            `**Projects:** ${details.projects.join(', ') || '(none)'}`,
            '',
            '## Summary',
            details.summary,
            '',
          ].join('\n');

          if (details.themes && details.themes.length > 0) {
            state.fullContent += '## Themes\n';
            for (const theme of details.themes) {
              state.fullContent += `- **${theme.name}**`;
              if (theme.summary) state.fullContent += `: ${theme.summary}`;
              state.fullContent += '\n';
            }
            state.fullContent += '\n';
          }

          if (details.quotes && details.quotes.length > 0) {
            state.fullContent += '## Key Quotes\n';
            for (const quote of details.quotes.slice(0, 10)) {
              const speaker = quote.speaker === 'user' ? '[You]' : `[${quote.speaker_name || 'Participant'}]`;
              state.fullContent += `> ${speaker} "${quote.text}"\n\n`;
            }
          }
        } else {
          state.fullContent = `Could not load content for ${source.title}`;
        }
      }
    }
  }

  // Store raw lines for searching
  state.fullContentLinesRaw = state.fullContent.split('\n');

  // Convert markdown to blessed tags (no ANSI codes)
  const rendered = markdownToBlessed(state.fullContent);
  state.fullContentLines = rendered.split('\n');

  // Reset search state
  state.docSearchPattern = '';
  state.docSearchMatches = [];
  state.docSearchCurrentIdx = 0;

  state.scrollOffset = 0;
  renderFullView(ui, state);
}

/**
 * Enter full view mode
 */
export async function enterFullView(
  state: BrowserState,
  ui: UIComponents,
  dbPath: string,
  sourcesDir: string
): Promise<void> {
  state.mode = 'fullview';
  ui.listPane.hide();
  ui.previewPane.hide();
  ui.fullViewPane.show();

  // Show loading state
  ui.fullViewContent.setContent('{blue-fg}Loading...{/blue-fg}');
  ui.screen.render();

  // Load content and render
  await loadFullContent(state, ui, dbPath, sourcesDir);
  ui.footer.setContent(' j/k Scroll │ / Search │ y Copy │ e Edit │ Esc Back');
  ui.screen.render();
}

/**
 * Exit full view mode
 */
export function exitFullView(state: BrowserState, ui: UIComponents): void {
  state.mode = 'list';
  ui.fullViewPane.hide();
  ui.listPane.show();
  ui.previewPane.show();
  ui.footer.setContent(' j/k Nav │ / Search │ a Ask │ R Research │ p Proj │ c Type │ m Move │ i Edit │ Esc Quit │ ? Help');
  ui.screen.render();
}

/**
 * Enter semantic/hybrid search mode
 */
export function enterSearch(state: BrowserState, ui: UIComponents): void {
  state.mode = 'search';
  state.searchMode = 'hybrid';
  ui.searchInput.show();
  ui.searchInput.setValue('/');
  ui.searchInput.focus();
  ui.screen.render();
}

/**
 * Enter regex search mode
 */
export function enterRegexSearch(state: BrowserState, ui: UIComponents): void {
  state.mode = 'regex-search';
  state.searchMode = 'regex';
  ui.regexInput.show();
  ui.regexInput.setValue(':');
  ui.regexInput.focus();
  ui.screen.render();
}

/**
 * Exit search mode
 */
export function exitSearch(state: BrowserState, ui: UIComponents): void {
  state.mode = 'list';
  ui.searchInput.hide();
  ui.regexInput.hide();
  ui.docSearchInput.hide();
  ui.listContent.focus();
  ui.screen.render();
}

/**
 * Enter document search mode (within full view)
 */
export function enterDocSearch(state: BrowserState, ui: UIComponents): void {
  state.mode = 'doc-search';
  ui.docSearchInput.show();
  ui.docSearchInput.setValue('/');
  ui.docSearchInput.focus();
  ui.screen.render();
}

/**
 * Exit document search mode
 */
export function exitDocSearch(state: BrowserState, ui: UIComponents, clearPattern = false): void {
  state.mode = 'fullview';
  ui.docSearchInput.hide();
  if (clearPattern) {
    state.docSearchPattern = '';
    state.docSearchMatches = [];
    state.docSearchCurrentIdx = 0;
  }
  renderFullView(ui, state);
}

/**
 * Apply document search pattern
 */
export function applyDocSearch(state: BrowserState, ui: UIComponents, pattern: string): void {
  state.docSearchPattern = pattern;
  state.docSearchMatches = [];
  state.docSearchCurrentIdx = 0;

  if (!pattern) {
    renderFullView(ui, state);
    return;
  }

  try {
    const regex = new RegExp(pattern, 'gi');

    // Find all lines that match
    for (let i = 0; i < state.fullContentLinesRaw.length; i++) {
      if (regex.test(state.fullContentLinesRaw[i])) {
        state.docSearchMatches.push(i);
      }
      regex.lastIndex = 0; // Reset for next test
    }

    // Jump to first match if found
    if (state.docSearchMatches.length > 0) {
      scrollToMatch(state, ui, 0);
    } else {
      renderFullView(ui, state);
    }
  } catch {
    // Invalid regex
    state.docSearchMatches = [];
    renderFullView(ui, state);
  }
}

/**
 * Scroll to a specific match
 */
export function scrollToMatch(state: BrowserState, ui: UIComponents, matchIdx: number): void {
  if (state.docSearchMatches.length === 0) return;

  state.docSearchCurrentIdx = matchIdx;
  const matchLine = state.docSearchMatches[matchIdx];
  const height = (ui.fullViewContent.height as number) - 1;

  // Center the match on screen
  state.scrollOffset = Math.max(0, matchLine - Math.floor(height / 2));
  state.scrollOffset = Math.min(state.scrollOffset, Math.max(0, state.fullContentLines.length - height));

  renderFullView(ui, state);
}

/**
 * Go to next match
 */
export function nextMatch(state: BrowserState, ui: UIComponents): void {
  if (state.docSearchMatches.length === 0) return;
  const nextIdx = (state.docSearchCurrentIdx + 1) % state.docSearchMatches.length;
  scrollToMatch(state, ui, nextIdx);
}

/**
 * Go to previous match
 */
export function prevMatch(state: BrowserState, ui: UIComponents): void {
  if (state.docSearchMatches.length === 0) return;
  const prevIdx = (state.docSearchCurrentIdx - 1 + state.docSearchMatches.length) % state.docSearchMatches.length;
  scrollToMatch(state, ui, prevIdx);
}

/**
 * Apply search filter
 */
export async function applyFilter(
  state: BrowserState,
  ui: UIComponents,
  query: string,
  filterMode: SearchMode,
  dbPath: string,
  dataDir: string,
  project?: string,
  sourceType?: SourceType
): Promise<void> {
  state.searchQuery = query;
  state.searchMode = filterMode;

  if (!query) {
    state.filtered = [...state.sources];
    state.searchMode = 'hybrid'; // Reset mode when clearing
  } else if (filterMode === 'regex') {
    // Use local regex search
    ui.statusBar.setContent(` Regex search "${query}"...`);
    ui.screen.render();

    try {
      const results = await searchLocalFiles(dataDir, query, {
        maxTotalResults: 50,
        maxMatchesPerFile: 5,
      });

      // Convert to SourceItem format, respecting project filter
      const sourceIds = results.map(r => r.source_id);
      state.filtered = state.sources
        .filter(s => {
          // Must match regex result
          if (!sourceIds.includes(s.id)) return false;
          // Must match project filter if set
          if (project && !s.projects.includes(project)) return false;
          return true;
        })
        .map(s => {
          const matchResult = results.find(r => r.source_id === s.id);
          return {
            ...s,
            score: matchResult ? matchResult.matches.length / 10 : 0,
          };
        })
        .sort((a, b) => (b.score || 0) - (a.score || 0));

      if (state.filtered.length === 0) {
        // No matches found
        const projectNote = project ? ` in project "${project}"` : '';
        ui.statusBar.setContent(` No regex matches for "${query}"${projectNote}`);
        ui.screen.render();
      }
    } catch (error) {
      ui.statusBar.setContent(` Regex error: ${error}`);
      ui.screen.render();
      state.filtered = [];
    }
  } else {
    // Use hybrid/semantic search
    ui.statusBar.setContent(` Searching "${query}"...`);
    ui.screen.render();

    try {
      // Use hybrid search
      const queryVector = await generateEmbedding(query);
      const results = await searchSources(dbPath, queryVector, {
        limit: 50,
        project,
        source_type: sourceType,
        mode: filterMode,
        queryText: query,
      });

      // Convert search results to SourceItem format, sorted by score
      state.filtered = results
        .sort((a, b) => b.score - a.score)  // Highest score first
        .map(r => ({
          id: r.id,
          title: r.title,
          source_type: r.source_type,
          content_type: r.content_type,
          projects: r.projects,
          created_at: r.created_at,
          indexed_at: r.created_at,
          summary: r.summary,
          score: r.score,
        }));
    } catch (error) {
      // Fall back to text filter on error
      ui.statusBar.setContent(` Search error, using text filter...`);
      ui.screen.render();

      const lower = query.toLowerCase();
      state.filtered = state.sources.filter(s =>
        s.title.toLowerCase().includes(lower) ||
        s.summary.toLowerCase().includes(lower) ||
        s.projects.some(p => p.toLowerCase().includes(lower)) ||
        s.content_type.toLowerCase().includes(lower)
      );
    }
  }

  // Apply content type filter if set
  if (state.currentContentType) {
    state.filtered = state.filtered.filter(s => s.content_type === state.currentContentType);
  }

  // Rebuild list items if in grouped mode
  if (state.groupByProject) {
    state.listItems = buildListItems(state);
  }

  state.selectedIndex = 0;
  updateStatus(ui, state, project, sourceType);
  renderList(ui, state);
  renderPreview(ui, state);
  ui.screen.render();
}

/**
 * Show help overlay
 */
export function showHelp(state: BrowserState, ui: UIComponents): void {
  state.mode = 'help';
  ui.helpPane.show();
  ui.screen.render();
}

/**
 * Hide help overlay
 */
export function hideHelp(state: BrowserState, ui: UIComponents): void {
  state.mode = 'list';
  ui.helpPane.hide();
  ui.screen.render();
}

// ============================================================================
// Tools View
// ============================================================================

export async function openInEditor(
  state: BrowserState,
  ui: UIComponents,
  sourcesDir: string
): Promise<void> {
  if (state.filtered.length === 0) return;

  // Get selected source (handles both grouped and flat view)
  const source = getSelectedSource(state);
  if (!source) return;

  const editorEnv = process.env.EDITOR || 'vi';

  // Parse editor command (might include args like "code -w")
  const editorParts = editorEnv.split(/\s+/);
  const editor = editorParts[0];
  const editorArgs = editorParts.slice(1);

  // Get content
  let content = state.fullContent;
  if (!content) {
    const contentPath = path.join(sourcesDir, source.id, 'content.md');
    try {
      const { readFile } = await import('fs/promises');
      content = await readFile(contentPath, 'utf-8');
    } catch {
      content = source.summary;
    }
  }

  // Write to temp file
  const tmpPath = path.join(tmpdir(), `lore-${source.id}.md`);
  writeFileSync(tmpPath, content);

  // Open editor in background (detached so TUI keeps running)
  const child = spawn(editor, [...editorArgs, tmpPath], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();  // Don't wait for editor to exit

  // Show confirmation
  ui.statusBar.setContent(` Opened in ${editor}`);
  ui.screen.render();

  // Clean up temp file after a delay (give editor time to read it)
  setTimeout(() => {
    try {
      unlinkSync(tmpPath);
    } catch {
      // Ignore - file might still be in use
    }
  }, 5000);
}

// Navigation functions
export function moveDown(state: BrowserState, ui: UIComponents): void {
  if (state.mode === 'fullview') {
    const maxScroll = Math.max(0, state.fullContentLines.length - ((ui.fullViewContent.height as number) - 1));
    state.scrollOffset = Math.min(state.scrollOffset + 1, maxScroll);
    renderFullView(ui, state);
  } else if (state.mode === 'list') {
    const maxIndex = state.groupByProject
      ? state.listItems.length - 1
      : state.filtered.length - 1;
    if (state.selectedIndex < maxIndex) {
      state.selectedIndex++;
      renderList(ui, state);
      renderPreview(ui, state);
    }
  }
  ui.screen.render();
}

export function moveUp(state: BrowserState, ui: UIComponents): void {
  if (state.mode === 'fullview') {
    state.scrollOffset = Math.max(0, state.scrollOffset - 1);
    renderFullView(ui, state);
  } else if (state.mode === 'list') {
    if (state.selectedIndex > 0) {
      state.selectedIndex--;
      renderList(ui, state);
      renderPreview(ui, state);
    }
  }
  ui.screen.render();
}

export function pageDown(state: BrowserState, ui: UIComponents): void {
  const pageSize = state.mode === 'fullview'
    ? (ui.fullViewContent.height as number) - 2
    : (ui.listContent.height as number) / 3;

  if (state.mode === 'fullview') {
    const maxScroll = Math.max(0, state.fullContentLines.length - ((ui.fullViewContent.height as number) - 1));
    state.scrollOffset = Math.min(state.scrollOffset + pageSize, maxScroll);
    renderFullView(ui, state);
  } else if (state.mode === 'list') {
    const maxIndex = state.groupByProject
      ? state.listItems.length - 1
      : state.filtered.length - 1;
    state.selectedIndex = Math.min(state.selectedIndex + Math.floor(pageSize), maxIndex);
    renderList(ui, state);
    renderPreview(ui, state);
  }
  ui.screen.render();
}

export function pageUp(state: BrowserState, ui: UIComponents): void {
  const pageSize = state.mode === 'fullview'
    ? (ui.fullViewContent.height as number) - 2
    : (ui.listContent.height as number) / 3;

  if (state.mode === 'fullview') {
    state.scrollOffset = Math.max(0, state.scrollOffset - pageSize);
    renderFullView(ui, state);
  } else if (state.mode === 'list') {
    state.selectedIndex = Math.max(state.selectedIndex - Math.floor(pageSize), 0);
    renderList(ui, state);
    renderPreview(ui, state);
  }
  ui.screen.render();
}

export function jumpToEnd(state: BrowserState, ui: UIComponents): void {
  if (state.mode === 'fullview') {
    state.scrollOffset = Math.max(0, state.fullContentLines.length - ((ui.fullViewContent.height as number) - 1));
    renderFullView(ui, state);
  } else if (state.mode === 'list') {
    const maxIndex = state.groupByProject
      ? state.listItems.length - 1
      : state.filtered.length - 1;
    state.selectedIndex = maxIndex;
    renderList(ui, state);
    renderPreview(ui, state);
  }
  ui.screen.render();
}

export function jumpToStart(state: BrowserState, ui: UIComponents): void {
  if (state.mode === 'fullview') {
    state.scrollOffset = 0;
    renderFullView(ui, state);
  } else if (state.mode === 'list') {
    state.selectedIndex = 0;
    renderList(ui, state);
    renderPreview(ui, state);
  }
  ui.screen.render();
}

/**
 * Trigger a manual sync
 */
export async function triggerSync(
  state: BrowserState,
  ui: UIComponents,
  dbPath: string,
  dataDir: string,
  project?: string,
  sourceType?: SourceType
): Promise<void> {
  ui.statusBar.setContent(' {yellow-fg}Syncing...{/yellow-fg}');
  ui.screen.render();

  try {
    const { handleSync } = await import('../mcp/handlers/sync.js');
    const { getAllSources } = await import('../core/vector-store.js');

    const result = await handleSync(
      dbPath,
      dataDir,
      {
        git_pull: true,
        git_push: true,
      },
      { hookContext: { mode: 'cli' } }
    );

    const processed = result.processing?.processed || 0;

    // Reload sources if anything was processed
    if (processed > 0) {
      state.sources = await getAllSources(dbPath, {
        project,
        source_type: sourceType,
        limit: state.loadLimit,
      });
      state.filtered = [...state.sources];
      state.selectedIndex = 0;
      renderList(ui, state);
      renderPreview(ui, state);
    }

    updateStatus(ui, state, project, sourceType);
    ui.statusBar.setContent(` {green-fg}Synced: ${processed} new file(s){/green-fg}`);
    ui.screen.render();

    // Restore normal status after a delay
    setTimeout(() => {
      updateStatus(ui, state, project, sourceType);
      ui.screen.render();
    }, 2000);
  } catch (error) {
    ui.statusBar.setContent(` {red-fg}Sync failed: ${error}{/red-fg}`);
    ui.screen.render();
  }
}

// ============================================================================
// Project Picker
// ============================================================================

/**
 * Load projects and show the project picker
 */
export async function showProjectPicker(
  state: BrowserState,
  ui: UIComponents,
  dbPath: string
): Promise<void> {
  ui.statusBar.setContent(' Loading projects...');
  ui.screen.render();

  try {
    const stats = await getProjectStats(dbPath);

    // Build projects list with special entries
    const projects: ProjectInfo[] = [];

    // Add "All Projects" option
    projects.push({
      name: '__all__',
      count: state.sources.length,
      latestActivity: new Date().toISOString(),
    });

    // Add "Unassigned" option (docs with empty projects array)
    const unassignedCount = state.sources.filter(s => s.projects.length === 0).length;
    if (unassignedCount > 0) {
      projects.push({
        name: '__unassigned__',
        count: unassignedCount,
        latestActivity: new Date().toISOString(),
      });
    }

    // Add actual projects
    for (const stat of stats) {
      projects.push({
        name: stat.project,
        count: stat.source_count,
        latestActivity: stat.latest_activity,
      });
    }

    state.projects = projects;
    state.projectPickerIndex = 0;

    // Find current project in list
    if (state.currentProject) {
      const idx = projects.findIndex(p => p.name === state.currentProject);
      if (idx >= 0) state.projectPickerIndex = idx;
    }

    state.mode = 'project-picker';
    renderProjectPicker(state, ui);
    ui.projectPicker.show();
    ui.screen.render();
  } catch (error) {
    ui.statusBar.setContent(` {red-fg}Failed to load projects: ${error}{/red-fg}`);
    ui.screen.render();
  }
}

/**
 * Render the project picker content
 */
export function renderProjectPicker(state: BrowserState, ui: UIComponents): void {
  const lines: string[] = [];
  lines.push('{bold}{yellow-fg}Select Project{/yellow-fg}{/bold}');
  lines.push('');

  for (let i = 0; i < state.projects.length; i++) {
    const p = state.projects[i];
    const isSelected = i === state.projectPickerIndex;
    const prefix = isSelected ? '{inverse} > ' : '   ';
    const suffix = isSelected ? ' {/inverse}' : '';

    let displayName: string;
    let extra = '';

    if (p.name === '__all__') {
      displayName = '{cyan-fg}[All Projects]{/cyan-fg}';
      extra = ` (${p.count})`;
    } else if (p.name === '__unassigned__') {
      displayName = '{magenta-fg}[Unassigned]{/magenta-fg}';
      extra = ` (${p.count})`;
    } else {
      displayName = p.name;
      const ago = formatRelativeTime(p.latestActivity);
      extra = ` (${p.count}, ${ago})`;
    }

    lines.push(`${prefix}${displayName}${extra}${suffix}`);
  }

  lines.push('');
  lines.push('{blue-fg}j/k: navigate  Enter: select  Esc: cancel{/blue-fg}');

  ui.projectPickerContent.setContent(lines.join('\n'));
}

/**
 * Format relative time for project display
 */
function formatRelativeTime(isoTime: string): string {
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
 * Navigate project picker down
 */
export function projectPickerDown(state: BrowserState, ui: UIComponents): void {
  if (state.projectPickerIndex < state.projects.length - 1) {
    state.projectPickerIndex++;
    renderProjectPicker(state, ui);
    ui.screen.render();
  }
}

/**
 * Navigate project picker up
 */
export function projectPickerUp(state: BrowserState, ui: UIComponents): void {
  if (state.projectPickerIndex > 0) {
    state.projectPickerIndex--;
    renderProjectPicker(state, ui);
    ui.screen.render();
  }
}

/**
 * Select current project and filter documents
 */
export async function selectProject(
  state: BrowserState,
  ui: UIComponents,
  dbPath: string,
  dataDir: string,
  sourceType?: SourceType
): Promise<void> {
  const selected = state.projects[state.projectPickerIndex];

  // Hide picker
  ui.projectPicker.hide();

  let newProject: string | undefined;

  if (selected.name === '__all__') {
    newProject = undefined;
  } else if (selected.name === '__unassigned__') {
    newProject = '__unassigned__';
  } else {
    newProject = selected.name;
  }

  state.currentProject = newProject;

  // Check if we should return to ask/research mode
  if (state.pickerReturnMode === 'ask') {
    state.mode = 'ask';
    state.pickerReturnMode = undefined;
    ui.listPane.hide();
    ui.previewPane.hide();
    ui.askInput.show();
    ui.askPane.show();
    ui.askPane.setLabel(' Ask Lore ');
    renderReturnToAskOrResearch(state, ui, 'ask');
    ui.askInput.focus();
    ui.askInput.readInput();
    ui.screen.render();
    return;
  } else if (state.pickerReturnMode === 'research') {
    state.mode = 'research';
    state.pickerReturnMode = undefined;
    ui.listPane.hide();
    ui.previewPane.hide();
    ui.askInput.show();
    ui.askPane.show();
    ui.askPane.setLabel(' Research Agent ');
    renderReturnToAskOrResearch(state, ui, 'research');
    ui.askInput.focus();
    ui.askInput.readInput();
    ui.screen.render();
    return;
  }

  state.mode = 'list';

  // Reload sources with new project filter
  ui.statusBar.setContent(' Filtering...');
  ui.screen.render();

  try {
    if (newProject === '__unassigned__') {
      // Special case: filter for docs with no project
      const allSources = await getAllSources(dbPath, {
        source_type: sourceType,
        limit: state.loadLimit,
      });
      state.sources = allSources.filter(s => s.projects.length === 0);
    } else {
      state.sources = await getAllSources(dbPath, {
        project: newProject,
        source_type: sourceType,
        limit: state.loadLimit,
      });
    }

    state.filtered = [...state.sources];
    state.selectedIndex = 0;
    state.searchQuery = '';

    updateStatus(ui, state, newProject, sourceType);
    renderList(ui, state);
    renderPreview(ui, state);
    ui.screen.render();
  } catch (error) {
    ui.statusBar.setContent(` {red-fg}Filter failed: ${error}{/red-fg}`);
    ui.screen.render();
  }
}

/**
 * Cancel project picker
 */
export function cancelProjectPicker(state: BrowserState, ui: UIComponents): void {
  ui.projectPicker.hide();

  // Check if we should return to ask/research mode
  if (state.pickerReturnMode === 'ask') {
    state.mode = 'ask';
    state.pickerReturnMode = undefined;
    ui.listPane.hide();
    ui.previewPane.hide();
    ui.askInput.show();
    ui.askPane.show();
    ui.askPane.setLabel(' Ask Lore ');
    renderReturnToAskOrResearch(state, ui, 'ask');
    ui.askInput.focus();
    ui.askInput.readInput();
  } else if (state.pickerReturnMode === 'research') {
    state.mode = 'research';
    state.pickerReturnMode = undefined;
    ui.listPane.hide();
    ui.previewPane.hide();
    ui.askInput.show();
    ui.askPane.show();
    ui.askPane.setLabel(' Research Agent ');
    renderReturnToAskOrResearch(state, ui, 'research');
    ui.askInput.focus();
    ui.askInput.readInput();
  } else {
    state.mode = 'list';
  }

  ui.screen.render();
}

/**
 * Clear project filter (show all)
 */
export async function clearProjectFilter(
  state: BrowserState,
  ui: UIComponents,
  dbPath: string,
  dataDir: string,
  sourceType?: SourceType
): Promise<void> {
  state.currentProject = undefined;

  ui.statusBar.setContent(' Loading all documents...');
  ui.screen.render();

  try {
    state.sources = await getAllSources(dbPath, {
      source_type: sourceType,
      limit: state.loadLimit,
    });

    state.filtered = [...state.sources];
    state.selectedIndex = 0;
    state.searchQuery = '';

    updateStatus(ui, state, undefined, sourceType);
    renderList(ui, state);
    renderPreview(ui, state);
    ui.screen.render();
  } catch (error) {
    ui.statusBar.setContent(` {red-fg}Failed: ${error}{/red-fg}`);
    ui.screen.render();
  }
}

// ============================================================================
// Delete Document
// ============================================================================

/**
 * Show delete confirmation dialog (for document or project)
 */
export function showDeleteConfirm(state: BrowserState, ui: UIComponents): void {
  if (state.filtered.length === 0) return;

  // Check if we're on a project header (project deletion)
  if (state.groupByProject && state.listItems.length > 0) {
    const item = state.listItems[state.selectedIndex];
    if (item?.type === 'header') {
      showProjectDeleteConfirm(state, ui, item);
      return;
    }
  }

  // Get selected source (handles both grouped and flat view)
  const source = getSelectedSource(state);
  if (!source) return;

  const title = source.title.length > 40
    ? source.title.slice(0, 37) + '...'
    : source.title;

  state.mode = 'delete-confirm';

  const lines = [
    '',
    '{bold}{red-fg}Delete Document?{/red-fg}{/bold}',
    '',
    `  {bold}${title}{/bold}`,
    '',
    '{yellow-fg}This will delete from Supabase and local files.{/yellow-fg}',
    '',
    '{blue-fg}  y: confirm delete    n/Esc: cancel{/blue-fg}',
  ];

  ui.deleteConfirm.setContent(lines.join('\n'));
  ui.deleteConfirm.show();
  ui.screen.render();
}

/**
 * Show delete confirmation for an entire project
 */
function showProjectDeleteConfirm(
  state: BrowserState,
  ui: UIComponents,
  header: Extract<import('./browse-types.js').ListItem, { type: 'header' }>
): void {
  state.mode = 'delete-confirm';

  const lines = [
    '',
    '{bold}{red-fg}Delete Entire Project?{/red-fg}{/bold}',
    '',
    `  {bold}{yellow-fg}${header.displayName}{/yellow-fg}{/bold}`,
    '',
    `{yellow-fg}This will delete ${header.documentCount} document${header.documentCount !== 1 ? 's' : ''}{/yellow-fg}`,
    '{yellow-fg}from Supabase and local files.{/yellow-fg}',
    '',
    '{blue-fg}  y: confirm delete    n/Esc: cancel{/blue-fg}',
  ];

  ui.deleteConfirm.setContent(lines.join('\n'));
  ui.deleteConfirm.show();
  ui.screen.render();
}

/**
 * Start an animated spinner in the status bar.
 * Returns a stop function that clears the interval.
 */
function startSpinner(ui: UIComponents, message: string): () => void {
  const frames = ['\u280b', '\u2819', '\u2838', '\u2834', '\u2826', '\u2807']; // braille dots spinner
  let i = 0;
  const interval = setInterval(() => {
    ui.statusBar.setContent(` {red-fg}{bold}${frames[i % frames.length]}{/bold}{/red-fg} {black-fg}{bold}${message}{/bold}{/black-fg}`);
    ui.screen.render();
    i++;
  }, 100);
  // Show first frame immediately
  ui.statusBar.setContent(` {red-fg}{bold}${frames[0]}{/bold}{/red-fg} {black-fg}{bold}${message}{/bold}{/black-fg}`);
  ui.screen.render();
  return () => clearInterval(interval);
}

/**
 * Cancel delete operation
 */
export function cancelDelete(state: BrowserState, ui: UIComponents): void {
  state.mode = 'list';
  ui.deleteConfirm.hide();
  ui.screen.render();
}

/**
 * Confirm and execute delete operation (document or project)
 */
export async function confirmDelete(
  state: BrowserState,
  ui: UIComponents,
  dbPath: string,
  dataDir: string,
  project?: string,
  sourceType?: import('../core/types.js').SourceType
): Promise<void> {
  if (state.filtered.length === 0) {
    cancelDelete(state, ui);
    return;
  }

  // Check if we're deleting a project
  if (state.groupByProject && state.listItems.length > 0) {
    const item = state.listItems[state.selectedIndex];
    if (item?.type === 'header') {
      await confirmProjectDelete(state, ui, dbPath, dataDir, item, project, sourceType);
      return;
    }
  }

  // Get selected source (handles both grouped and flat view)
  const source = getSelectedSource(state);
  if (!source) {
    cancelDelete(state, ui);
    return;
  }

  // Hide dialog and show progress
  ui.deleteConfirm.hide();
  state.mode = 'list';
  const stopSpinner = startSpinner(ui, `Deleting "${source.title}"...`);

  try {
    // 1. Delete from Supabase (this also handles chunks cascade)
    const { sourcePath: originalPath } = await deleteSource(dbPath, source.id);

    // 2. Delete local files in data directory
    const { rm } = await import('fs/promises');
    const loreSourcePath = path.join(dataDir, 'sources', source.id);
    try {
      await rm(loreSourcePath, { recursive: true });
    } catch {
      // File may not exist on disk - that's ok
    }

    // 3. Delete original source file from sync directory (and commit to its repo)
    if (originalPath) {
      await deleteFileAndCommit(originalPath, `Delete: ${source.title.slice(0, 50)}`);
    }

    // 4. Git commit and push the lore-data changes
    await gitCommitAndPush(dataDir, `Delete source: ${source.title.slice(0, 50)}`);

    // 4. Refresh the source list
    state.sources = await getAllSources(dbPath, {
      project: state.currentProject,
      source_type: sourceType,
      limit: state.loadLimit,
    });
    state.filtered = [...state.sources];

    // Rebuild list items if in grouped mode
    if (state.groupByProject) {
      state.listItems = buildListItems(state);
      // Adjust selection if needed
      if (state.selectedIndex >= state.listItems.length) {
        state.selectedIndex = Math.max(0, state.listItems.length - 1);
      }
    } else {
      // Adjust selection if needed
      if (state.selectedIndex >= state.filtered.length) {
        state.selectedIndex = Math.max(0, state.filtered.length - 1);
      }
    }

    stopSpinner();

    // Update UI
    updateStatus(ui, state, state.currentProject, sourceType);
    renderList(ui, state);
    renderPreview(ui, state);

    ui.statusBar.setContent(` {black-fg}{bold}Deleted successfully{/bold}{/black-fg}`);
    ui.screen.render();

    // Restore normal status after delay
    setTimeout(() => {
      updateStatus(ui, state, state.currentProject, sourceType);
      ui.screen.render();
    }, 2000);
  } catch (error) {
    stopSpinner();
    ui.statusBar.setContent(` {red-fg}Delete failed: ${error}{/red-fg}`);
    ui.screen.render();
  }
}

/**
 * Confirm and execute project deletion (all documents in a project)
 */
async function confirmProjectDelete(
  state: BrowserState,
  ui: UIComponents,
  dbPath: string,
  dataDir: string,
  header: Extract<import('./browse-types.js').ListItem, { type: 'header' }>,
  project?: string,
  sourceType?: import('../core/types.js').SourceType
): Promise<void> {
  // Hide dialog and show spinner
  ui.deleteConfirm.hide();
  state.mode = 'list';
  const stopSpinner = startSpinner(ui, `Deleting ${header.documentCount} documents from "${header.displayName}"...`);

  try {
    // Get all documents in this project
    const docsToDelete = state.filtered.filter(s => {
      if (header.projectName === '__unassigned__') {
        return s.projects.length === 0;
      }
      return s.projects.includes(header.projectName);
    });

    let deleted = 0;
    const errors: string[] = [];

    const { rm } = await import('fs/promises');
    for (const source of docsToDelete) {
      try {
        // Delete from Supabase
        const { sourcePath: originalPath } = await deleteSource(dbPath, source.id);

        // Delete local files
        const loreSourcePath = path.join(dataDir, 'sources', source.id);
        try {
          await rm(loreSourcePath, { recursive: true });
        } catch {
          // File may not exist on disk
        }

        // Delete original source file from sync directory (and commit to its repo)
        if (originalPath) {
          await deleteFileAndCommit(originalPath, `Delete: ${source.title.slice(0, 50)}`);
        }

        deleted++;
        ui.statusBar.setContent(` {yellow-fg}Deleting... ${deleted}/${docsToDelete.length}{/yellow-fg}`);
        ui.screen.render();
      } catch (err) {
        errors.push(`${source.title}: ${err}`);
      }
    }

    // Git commit and push the deletions
    await gitCommitAndPush(dataDir, `Delete project: ${header.displayName} (${deleted} documents)`);

    // Remove from expanded set
    state.expandedProjects.delete(header.projectName);

    // Clear project filter - after deleting a project, show all remaining
    state.currentProject = undefined;

    // Refresh the source list (no project filter - show all remaining)
    state.sources = await getAllSources(dbPath, {
      source_type: sourceType,
      limit: state.loadLimit,
    });
    state.filtered = [...state.sources];

    // Rebuild list items
    if (state.groupByProject) {
      state.listItems = buildListItems(state);
      if (state.selectedIndex >= state.listItems.length) {
        state.selectedIndex = Math.max(0, state.listItems.length - 1);
      }
    } else {
      if (state.selectedIndex >= state.filtered.length) {
        state.selectedIndex = Math.max(0, state.filtered.length - 1);
      }
    }

    stopSpinner();

    // Update UI
    updateStatus(ui, state, state.currentProject, sourceType);
    renderList(ui, state);
    renderPreview(ui, state);

    if (errors.length > 0) {
      ui.statusBar.setContent(` {black-fg}{bold}Deleted ${deleted} documents, ${errors.length} failed{/bold}{/black-fg}`);
    } else {
      ui.statusBar.setContent(` {black-fg}{bold}Deleted ${deleted} documents{/bold}{/black-fg}`);
    }
    ui.screen.render();

    // Restore normal status after delay
    setTimeout(() => {
      updateStatus(ui, state, state.currentProject, sourceType);
      ui.screen.render();
    }, 2000);
  } catch (error) {
    stopSpinner();
    ui.statusBar.setContent(` {red-fg}Delete failed: ${error}{/red-fg}`);
    ui.screen.render();
  }
}

// ============================================================================
// Clipboard Copy
// ============================================================================

/**
 * Copy text to system clipboard
 */
function copyToClipboard(text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const platform = process.platform;
    let cmd: string;
    let args: string[];

    if (platform === 'darwin') {
      cmd = 'pbcopy';
      args = [];
    } else if (platform === 'linux') {
      // Try xclip first, fall back to xsel
      cmd = 'xclip';
      args = ['-selection', 'clipboard'];
    } else if (platform === 'win32') {
      cmd = 'clip';
      args = [];
    } else {
      reject(new Error(`Unsupported platform: ${platform}`));
      return;
    }

    const proc = spawn(cmd, args, { stdio: ['pipe', 'ignore', 'ignore'] });
    proc.stdin?.write(text);
    proc.stdin?.end();

    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Clipboard command failed with code ${code}`));
      }
    });

    proc.on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * Copy current view content to clipboard
 */
export async function copyCurrentContent(
  state: BrowserState,
  ui: UIComponents
): Promise<void> {
  let content: string | null = null;
  let description = '';

  if (state.mode === 'fullview') {
    content = state.fullContent;
    description = 'Document';
  } else if (state.mode === 'ask' && state.askResponse) {
    content = state.askResponse;
    description = 'Response';
  } else if (state.mode === 'research' && state.researchResponse) {
    content = state.researchResponse;
    description = 'Research result';
  }

  if (!content) {
    ui.statusBar.setContent(' {yellow-fg}Nothing to copy{/yellow-fg}');
    ui.screen.render();
    setTimeout(() => {
      updateStatus(ui, state, state.currentProject);
      ui.screen.render();
    }, 1500);
    return;
  }

  try {
    await copyToClipboard(content);
    ui.statusBar.setContent(` {green-fg}${description} copied to clipboard{/green-fg}`);
    ui.screen.render();
    setTimeout(() => {
      updateStatus(ui, state, state.currentProject);
      ui.screen.render();
    }, 1500);
  } catch (error) {
    ui.statusBar.setContent(` {red-fg}Copy failed: ${error}{/red-fg}`);
    ui.screen.render();
  }
}

// ============================================================================
// Move Document to Project
// ============================================================================

/**
 * Show move picker to relocate a document to a different project
 */
export async function showMovePicker(
  state: BrowserState,
  ui: UIComponents,
  dbPath: string
): Promise<void> {
  // Get selected source
  const source = getSelectedSource(state);
  if (!source) {
    ui.statusBar.setContent(' {yellow-fg}No document selected{/yellow-fg}');
    ui.screen.render();
    return;
  }

  state.moveTargetSource = source;
  ui.statusBar.setContent(' Loading projects...');
  ui.screen.render();

  try {
    const stats = await getProjectStats(dbPath);

    // Build projects list (no "All Projects" option - doesn't make sense for move)
    const projects: ProjectInfo[] = [];

    // Add "New Project..." option at top
    projects.push({
      name: '__new__',
      count: 0,
      latestActivity: new Date().toISOString(),
    });

    // Add actual projects
    for (const stat of stats) {
      projects.push({
        name: stat.project,
        count: stat.source_count,
        latestActivity: stat.latest_activity,
      });
    }

    state.movePickerProjects = projects;
    state.movePickerIndex = 0;

    // Find current project in list (skip if doc has no project)
    const currentProj = source.projects[0];
    if (currentProj) {
      const idx = projects.findIndex(p => p.name === currentProj);
      if (idx >= 0) state.movePickerIndex = idx;
    }

    state.mode = 'move-picker';
    renderMovePicker(state, ui);
    ui.projectPicker.show();
    ui.screen.render();
  } catch (error) {
    ui.statusBar.setContent(` {red-fg}Failed to load projects: ${error}{/red-fg}`);
    ui.screen.render();
  }
}

/**
 * Render the move picker UI
 */
export function renderMovePicker(state: BrowserState, ui: UIComponents): void {
  const source = state.moveTargetSource;
  const currentProject = source?.projects[0] || '(none)';

  const lines: string[] = [];
  lines.push('{bold}{yellow-fg}Move Document to Project{/yellow-fg}{/bold}');
  lines.push(`{gray-fg}Current: ${currentProject}{/gray-fg}`);
  lines.push('');

  for (let i = 0; i < state.movePickerProjects.length; i++) {
    const p = state.movePickerProjects[i];
    const isSelected = i === state.movePickerIndex;
    const isCurrent = p.name === source?.projects[0];
    const prefix = isSelected ? '{inverse} > ' : '   ';
    const suffix = isSelected ? ' {/inverse}' : '';

    let displayName: string;
    let extra = '';

    if (p.name === '__new__') {
      displayName = '{cyan-fg}[New Project...]{/cyan-fg}';
    } else {
      displayName = p.name;
      const ago = formatRelativeTime(p.latestActivity);
      extra = ` (${p.count}, ${ago})`;
      if (isCurrent) {
        extra += ' {magenta-fg}(current){/magenta-fg}';
      }
    }

    lines.push(`${prefix}${displayName}${extra}${suffix}`);
  }

  lines.push('');
  lines.push('{blue-fg}j/k: navigate  Enter: move  Esc: cancel{/blue-fg}');

  ui.projectPickerContent.setContent(lines.join('\n'));
}

/**
 * Navigate down in move picker
 */
export function movePickerDown(state: BrowserState, ui: UIComponents): void {
  if (state.movePickerIndex < state.movePickerProjects.length - 1) {
    state.movePickerIndex++;
    renderMovePicker(state, ui);
    ui.screen.render();
  }
}

/**
 * Navigate up in move picker
 */
export function movePickerUp(state: BrowserState, ui: UIComponents): void {
  if (state.movePickerIndex > 0) {
    state.movePickerIndex--;
    renderMovePicker(state, ui);
    ui.screen.render();
  }
}

/**
 * Confirm move to selected project
 */
export async function confirmMove(
  state: BrowserState,
  ui: UIComponents,
  dbPath: string,
  dataDir: string,
  sourceType?: SourceType
): Promise<void> {
  const source = state.moveTargetSource;
  if (!source) {
    cancelMovePicker(state, ui);
    return;
  }

  const selected = state.movePickerProjects[state.movePickerIndex];

  // Handle "New Project..." option
  if (selected.name === '__new__') {
    // Show input for new project name
    ui.projectPicker.hide();
    state.mode = 'list';

    // For now, show a message that they need to type a project name
    // In the future, we could add a text input modal
    ui.statusBar.setContent(' {yellow-fg}New project creation coming soon. Use edit (i) to set project name.{/yellow-fg}');
    ui.screen.render();
    setTimeout(() => {
      updateStatus(ui, state, state.currentProject, sourceType);
      ui.screen.render();
    }, 2000);
    return;
  }

  // Don't move if same project
  if (source.projects.includes(selected.name)) {
    ui.projectPicker.hide();
    state.mode = 'list';
    ui.statusBar.setContent(' {yellow-fg}Document already in this project{/yellow-fg}');
    ui.screen.render();
    setTimeout(() => {
      updateStatus(ui, state, state.currentProject, sourceType);
      ui.screen.render();
    }, 1500);
    return;
  }

  ui.projectPicker.hide();
  ui.statusBar.setContent(` Moving to "${selected.name}"...`);
  ui.screen.render();

  try {
    // Update the source's projects array (replace, not add)
    const success = await updateSourceProjects(dbPath, source.id, [selected.name]);

    if (!success) {
      throw new Error('Failed to update source');
    }

    // Update the local source object
    source.projects = [selected.name];

    // Rebuild list if in grouped mode
    if (state.groupByProject) {
      state.listItems = buildListItems(state);
    }

    state.mode = 'list';
    renderList(ui, state);
    renderPreview(ui, state);

    ui.statusBar.setContent(` {green-fg}Moved to "${selected.name}"{/green-fg}`);
    ui.screen.render();

    setTimeout(() => {
      updateStatus(ui, state, state.currentProject, sourceType);
      ui.screen.render();
    }, 1500);

  } catch (error) {
    state.mode = 'list';
    ui.statusBar.setContent(` {red-fg}Move failed: ${error}{/red-fg}`);
    ui.screen.render();
  }
}

/**
 * Cancel move picker
 */
export function cancelMovePicker(state: BrowserState, ui: UIComponents): void {
  ui.projectPicker.hide();
  state.mode = 'list';
  state.moveTargetSource = undefined;
  ui.screen.render();
}

// ============================================================================
// Edit Document Info
// ============================================================================

/**
 * Enter edit info mode for the selected document
 */
export function enterEditInfo(
  state: BrowserState,
  ui: UIComponents
): void {
  const source = getSelectedSource(state);
  if (!source) {
    ui.statusBar.setContent(' {yellow-fg}No document selected{/yellow-fg}');
    ui.screen.render();
    return;
  }

  state.editSource = source;
  state.editTitle = source.title;
  state.editProjects = [...source.projects];
  state.editFieldIndex = 0;
  state.mode = 'edit-info';

  // Hide list/preview, show edit pane
  ui.listPane.hide();
  ui.previewPane.hide();

  // Show the input with current title - update label on input box
  ui.askInput.setLabel(' Edit Title ');
  ui.askInput.setValue(source.title);
  ui.askInput.show();
  
  // Show info pane with instructions
  ui.askPane.setLabel(' Document Info ');
  ui.askPane.setContent('{cyan-fg}Edit the title above and press Enter to save{/cyan-fg}\n\n{gray-fg}Press Esc to cancel{/gray-fg}');
  ui.askPane.show();

  ui.footer.setContent(' Enter: Save │ Esc: Cancel');
  ui.askInput.focus();
  ui.askInput.readInput();
  ui.screen.render();
}

/**
 * Save edit info changes
 */
export async function saveEditInfo(
  state: BrowserState,
  ui: UIComponents,
  dbPath: string,
  sourceType?: SourceType
): Promise<void> {
  const source = state.editSource;
  if (!source) {
    exitEditInfo(state, ui);
    return;
  }

  ui.askPane.setContent('{yellow-fg}Saving...{/yellow-fg}');
  ui.screen.render();

  try {
    let updated = false;

    // Update title if changed
    if (state.editTitle !== source.title && state.editTitle.trim()) {
      const success = await updateSourceTitle(dbPath, source.id, state.editTitle.trim());
      if (success) {
        source.title = state.editTitle.trim();
        updated = true;
      }
    }

    // Update projects if changed
    const newProjects = state.editProjects.filter(p => p.trim());
    const projectsChanged = JSON.stringify(newProjects) !== JSON.stringify(source.projects);
    if (projectsChanged) {
      const success = await updateSourceProjects(dbPath, source.id, newProjects);
      if (success) {
        source.projects = newProjects;
        updated = true;
      }
    }

    exitEditInfo(state, ui);

    // Rebuild list if in grouped mode
    if (state.groupByProject) {
      state.listItems = buildListItems(state);
    }

    renderList(ui, state);
    renderPreview(ui, state);

    if (updated) {
      ui.statusBar.setContent(' {green-fg}Document updated{/green-fg}');
    } else {
      ui.statusBar.setContent(' {gray-fg}No changes{/gray-fg}');
    }
    ui.screen.render();

    setTimeout(() => {
      updateStatus(ui, state, state.currentProject, sourceType);
      ui.screen.render();
    }, 1500);

  } catch (error) {
    exitEditInfo(state, ui);
    ui.statusBar.setContent(` {red-fg}Save failed: ${error}{/red-fg}`);
    ui.screen.render();
  }
}

/**
 * Exit edit info mode without saving
 */
export function exitEditInfo(state: BrowserState, ui: UIComponents): void {
  state.mode = 'list';
  state.editSource = undefined;
  state.editTitle = '';
  state.editProjects = [];
  state.editFieldIndex = 0;

  // Hide and reset ask components
  ui.askInput.hide();
  ui.askInput.setValue('');
  ui.askInput.setLabel(' Ask Lore ');
  ui.askPane.hide();
  ui.askPane.setLabel(' Response ');

  ui.listPane.show();
  ui.previewPane.show();

  ui.footer.setContent(' j/k Nav │ / Search │ a Ask │ R Research │ p Proj │ c Type │ m Move │ i Edit │ Esc Quit │ ? Help');
  ui.listContent.focus();
  ui.screen.render();
}


// ============================================================================
// Edit Content Type (Type Picker)
// ============================================================================

// Valid content types
const CONTENT_TYPES = [
  'interview',
  'meeting',
  'conversation',
  'document',
  'note',
  'analysis',
] as const;

/**
 * Show type picker to change document content type
 */
export function showTypePicker(
  state: BrowserState,
  ui: UIComponents
): void {
  const source = getSelectedSource(state);
  if (!source) {
    ui.statusBar.setContent(' {yellow-fg}No document selected{/yellow-fg}');
    ui.screen.render();
    return;
  }

  state.typePickerSource = source;
  state.typePickerIndex = 0;

  // Find current type in list
  const currentIdx = CONTENT_TYPES.indexOf(source.content_type as typeof CONTENT_TYPES[number]);
  if (currentIdx >= 0) {
    state.typePickerIndex = currentIdx;
  }

  state.mode = 'type-picker';
  renderTypePicker(state, ui);
  ui.projectPicker.show();
  ui.screen.render();
}

/**
 * Render the type picker UI
 */
export function renderTypePicker(state: BrowserState, ui: UIComponents): void {
  const source = state.typePickerSource;
  const currentType = source?.content_type || '(unknown)';

  const lines: string[] = [];
  lines.push('{bold}{yellow-fg}Change Content Type{/yellow-fg}{/bold}');
  lines.push(`{gray-fg}Current: ${currentType}{/gray-fg}`);
  lines.push('');

  for (let i = 0; i < CONTENT_TYPES.length; i++) {
    const type = CONTENT_TYPES[i];
    const isSelected = i === state.typePickerIndex;
    const isCurrent = type === source?.content_type;
    const prefix = isSelected ? '{inverse} > ' : '   ';
    const suffix = isSelected ? ' {/inverse}' : '';

    let displayName = type;
    let extra = '';
    if (isCurrent) {
      extra = ' {magenta-fg}(current){/magenta-fg}';
    }

    lines.push(`${prefix}${displayName}${extra}${suffix}`);
  }

  lines.push('');
  lines.push('{blue-fg}j/k: navigate  Enter: select  Esc: cancel{/blue-fg}');

  ui.projectPickerContent.setContent(lines.join('\n'));
}

/**
 * Navigate down in type picker
 */
export function typePickerDown(state: BrowserState, ui: UIComponents): void {
  if (state.typePickerIndex < CONTENT_TYPES.length - 1) {
    state.typePickerIndex++;
    renderTypePicker(state, ui);
    ui.screen.render();
  }
}

/**
 * Navigate up in type picker
 */
export function typePickerUp(state: BrowserState, ui: UIComponents): void {
  if (state.typePickerIndex > 0) {
    state.typePickerIndex--;
    renderTypePicker(state, ui);
    ui.screen.render();
  }
}

/**
 * Confirm type selection
 */
export async function confirmTypeChange(
  state: BrowserState,
  ui: UIComponents,
  dbPath: string,
  sourceType?: SourceType
): Promise<void> {
  const source = state.typePickerSource;
  if (!source) {
    cancelTypePicker(state, ui);
    return;
  }

  const selectedType = CONTENT_TYPES[state.typePickerIndex];

  // Don't update if same type
  if (selectedType === source.content_type) {
    ui.projectPicker.hide();
    state.mode = 'list';
    ui.statusBar.setContent(' {yellow-fg}No change{/yellow-fg}');
    ui.screen.render();
    setTimeout(() => {
      updateStatus(ui, state, state.currentProject, sourceType);
      ui.screen.render();
    }, 1500);
    return;
  }

  ui.projectPicker.hide();
  ui.statusBar.setContent(` Updating type to "${selectedType}"...`);
  ui.screen.render();

  try {
    const success = await updateSourceContentType(dbPath, source.id, selectedType);

    if (!success) {
      throw new Error('Failed to update content type');
    }

    // Update the local source object
    (source as any).content_type = selectedType;

    state.mode = 'list';
    renderList(ui, state);
    renderPreview(ui, state);

    ui.statusBar.setContent(` {green-fg}Type changed to "${selectedType}"{/green-fg}`);
    ui.screen.render();

    setTimeout(() => {
      updateStatus(ui, state, state.currentProject, sourceType);
      ui.screen.render();
    }, 1500);

  } catch (error) {
    state.mode = 'list';
    ui.statusBar.setContent(` {red-fg}Update failed: ${error}{/red-fg}`);
    ui.screen.render();
  }
}

/**
 * Cancel type picker
 */
export function cancelTypePicker(state: BrowserState, ui: UIComponents): void {
  ui.projectPicker.hide();
  state.mode = 'list';
  state.typePickerSource = undefined;
  ui.screen.render();
}


// ============================================================================
// Content Type Filter (Filter list by content type)
// ============================================================================

// Content types for filtering (includes "All" option)
const FILTER_CONTENT_TYPES = [
  '__all__',
  'interview',
  'meeting',
  'conversation',
  'document',
  'note',
  'analysis',
] as const;

/**
 * Show content type filter picker
 */
export function showContentTypeFilter(state: BrowserState, ui: UIComponents): void {
  state.contentTypeFilterIndex = 0;

  // Find current filter in list
  if (state.currentContentType) {
    const idx = FILTER_CONTENT_TYPES.indexOf(state.currentContentType as typeof FILTER_CONTENT_TYPES[number]);
    if (idx >= 0) {
      state.contentTypeFilterIndex = idx;
    }
  }

  state.mode = 'content-type-filter';
  renderContentTypeFilter(state, ui);
  ui.projectPicker.show();
  ui.screen.render();
}

/**
 * Render the content type filter UI
 */
export function renderContentTypeFilter(state: BrowserState, ui: UIComponents): void {
  const currentFilter = state.currentContentType || 'All';

  const lines: string[] = [];
  lines.push('{bold}{yellow-fg}Filter by Content Type{/yellow-fg}{/bold}');
  lines.push(`{gray-fg}Current: ${currentFilter}{/gray-fg}`);
  lines.push('');

  for (let i = 0; i < FILTER_CONTENT_TYPES.length; i++) {
    const type = FILTER_CONTENT_TYPES[i];
    const isSelected = i === state.contentTypeFilterIndex;
    const isCurrent = type === state.currentContentType || (type === '__all__' && !state.currentContentType);
    const prefix = isSelected ? '{inverse} > ' : '   ';
    const suffix = isSelected ? ' {/inverse}' : '';

    let displayName = type === '__all__' ? '{cyan-fg}[All Types]{/cyan-fg}' : type;
    let extra = '';
    if (isCurrent) {
      extra = ' {magenta-fg}(current){/magenta-fg}';
    }

    lines.push(`${prefix}${displayName}${extra}${suffix}`);
  }

  lines.push('');
  lines.push('{blue-fg}j/k: navigate  Enter: select  Esc: cancel{/blue-fg}');

  ui.projectPickerContent.setContent(lines.join('\n'));
}

/**
 * Navigate down in content type filter
 */
export function contentTypeFilterDown(state: BrowserState, ui: UIComponents): void {
  if (state.contentTypeFilterIndex < FILTER_CONTENT_TYPES.length - 1) {
    state.contentTypeFilterIndex++;
    renderContentTypeFilter(state, ui);
    ui.screen.render();
  }
}

/**
 * Navigate up in content type filter
 */
export function contentTypeFilterUp(state: BrowserState, ui: UIComponents): void {
  if (state.contentTypeFilterIndex > 0) {
    state.contentTypeFilterIndex--;
    renderContentTypeFilter(state, ui);
    ui.screen.render();
  }
}

/**
 * Apply content type filter
 */
export async function applyContentTypeFilter(
  state: BrowserState,
  ui: UIComponents,
  dbPath: string,
  dataDir: string,
  sourceType?: SourceType
): Promise<void> {
  const selectedType = FILTER_CONTENT_TYPES[state.contentTypeFilterIndex];

  ui.projectPicker.hide();

  const newFilter = selectedType === '__all__' ? undefined : selectedType;
  state.currentContentType = newFilter;

  // Check if we should return to ask/research mode
  if (state.pickerReturnMode === 'ask') {
    state.mode = 'ask';
    state.pickerReturnMode = undefined;
    ui.listPane.hide();
    ui.previewPane.hide();
    ui.askInput.show();
    ui.askPane.show();
    ui.askPane.setLabel(' Ask Lore ');
    renderReturnToAskOrResearch(state, ui, 'ask');
    ui.askInput.focus();
    ui.askInput.readInput();
    ui.screen.render();
    return;
  } else if (state.pickerReturnMode === 'research') {
    state.mode = 'research';
    state.pickerReturnMode = undefined;
    ui.listPane.hide();
    ui.previewPane.hide();
    ui.askInput.show();
    ui.askPane.show();
    ui.askPane.setLabel(' Research Agent ');
    renderReturnToAskOrResearch(state, ui, 'research');
    ui.askInput.focus();
    ui.askInput.readInput();
    ui.screen.render();
    return;
  }

  state.mode = 'list';

  ui.statusBar.setContent(' Filtering...');
  ui.screen.render();

  try {
    // Reload sources with content type filter
    // Note: getAllSources doesn't support content_type filter directly,
    // so we filter client-side for now
    state.sources = await getAllSources(dbPath, {
      project: state.currentProject,
      source_type: sourceType,
      limit: state.loadLimit,
    });

    // Apply content type filter client-side
    if (newFilter) {
      state.filtered = state.sources.filter(s => s.content_type === newFilter);
    } else {
      state.filtered = [...state.sources];
    }

    state.selectedIndex = 0;

    // Rebuild list items if in grouped mode
    if (state.groupByProject) {
      state.listItems = buildListItems(state);
    }

    updateStatus(ui, state, state.currentProject, sourceType);
    renderList(ui, state);
    renderPreview(ui, state);
    ui.screen.render();
  } catch (error) {
    ui.statusBar.setContent(` {red-fg}Filter failed: ${error}{/red-fg}`);
    ui.screen.render();
  }
}

/**
 * Cancel content type filter picker
 */
export function cancelContentTypeFilter(state: BrowserState, ui: UIComponents): void {
  ui.projectPicker.hide();

  // Check if we should return to ask/research mode
  if (state.pickerReturnMode === 'ask') {
    state.mode = 'ask';
    state.pickerReturnMode = undefined;
    ui.listPane.hide();
    ui.previewPane.hide();
    ui.askInput.show();
    ui.askPane.show();
    ui.askPane.setLabel(' Ask Lore ');
    renderReturnToAskOrResearch(state, ui, 'ask');
    ui.askInput.focus();
    ui.askInput.readInput();
  } else if (state.pickerReturnMode === 'research') {
    state.mode = 'research';
    state.pickerReturnMode = undefined;
    ui.listPane.hide();
    ui.previewPane.hide();
    ui.askInput.show();
    ui.askPane.show();
    ui.askPane.setLabel(' Research Agent ');
    renderReturnToAskOrResearch(state, ui, 'research');
    ui.askInput.focus();
    ui.askInput.readInput();
  } else {
    state.mode = 'list';
  }

  ui.screen.render();
}

/**
 * Clear content type filter
 */
export async function clearContentTypeFilter(
  state: BrowserState,
  ui: UIComponents,
  dbPath: string,
  dataDir: string,
  sourceType?: SourceType
): Promise<void> {
  state.currentContentType = undefined;

  ui.statusBar.setContent(' Clearing filter...');
  ui.screen.render();

  try {
    state.sources = await getAllSources(dbPath, {
      project: state.currentProject,
      source_type: sourceType,
      limit: state.loadLimit,
    });

    state.filtered = [...state.sources];
    state.selectedIndex = 0;

    if (state.groupByProject) {
      state.listItems = buildListItems(state);
    }

    updateStatus(ui, state, state.currentProject, sourceType);
    renderList(ui, state);
    renderPreview(ui, state);
    ui.screen.render();
  } catch (error) {
    ui.statusBar.setContent(` {red-fg}Clear failed: ${error}{/red-fg}`);
    ui.screen.render();
  }
}

// ============================================================================
// Project Folders (Collapsible Groups)
// ============================================================================

/**
 * Toggle expand/collapse for the currently selected project header
 */
export function toggleProjectExpand(state: BrowserState, ui: UIComponents): boolean {
  if (!state.groupByProject || state.listItems.length === 0) {
    return false;
  }

  const item = state.listItems[state.selectedIndex];
  if (!item || item.type !== 'header') {
    return false;
  }

  // Toggle expansion
  if (state.expandedProjects.has(item.projectName)) {
    state.expandedProjects.delete(item.projectName);
  } else {
    state.expandedProjects.add(item.projectName);
  }

  // Rebuild list items and re-render
  state.listItems = buildListItems(state);
  renderList(ui, state);
  renderPreview(ui, state);
  ui.screen.render();
  return true;
}

/**
 * Expand the currently selected project (or the project containing the selected doc)
 */
export function expandCurrentProject(state: BrowserState, ui: UIComponents): void {
  if (!state.groupByProject || state.listItems.length === 0) return;

  const item = state.listItems[state.selectedIndex];
  if (!item) return;

  const projectName = item.type === 'header' ? item.projectName : item.projectName;

  if (!state.expandedProjects.has(projectName)) {
    state.expandedProjects.add(projectName);
    state.listItems = buildListItems(state);
    renderList(ui, state);
    renderPreview(ui, state);
    ui.screen.render();
  }
}

/**
 * Collapse the currently selected project (or the project containing the selected doc)
 */
export function collapseCurrentProject(state: BrowserState, ui: UIComponents): void {
  if (!state.groupByProject || state.listItems.length === 0) return;

  const item = state.listItems[state.selectedIndex];
  if (!item) return;

  const projectName = item.type === 'header' ? item.projectName : item.projectName;

  if (state.expandedProjects.has(projectName)) {
    state.expandedProjects.delete(projectName);

    // Find the header for this project and move selection to it
    state.listItems = buildListItems(state);
    const headerIdx = state.listItems.findIndex(
      i => i.type === 'header' && i.projectName === projectName
    );
    if (headerIdx >= 0) {
      state.selectedIndex = headerIdx;
    }

    renderList(ui, state);
    renderPreview(ui, state);
    ui.screen.render();
  }
}

/**
 * Toggle grouped view mode
 */
export function toggleGroupedView(state: BrowserState, ui: UIComponents): void {
  state.groupByProject = !state.groupByProject;

  if (state.groupByProject) {
    // Switching to grouped view - rebuild list items
    state.listItems = buildListItems(state);
    state.selectedIndex = 0;
  } else {
    // Switching to flat view
    state.listItems = [];
    state.selectedIndex = 0;
  }

  renderList(ui, state);
  renderPreview(ui, state);
  ui.screen.render();
}

/**
 * Check if selection is on a document (for Enter key handling)
 */
export function isDocumentSelected(state: BrowserState): boolean {
  if (!state.groupByProject) {
    return state.filtered.length > 0;
  }

  const item = state.listItems[state.selectedIndex];
  return item?.type === 'document';
}

/**
 * Get the selected source for full view (handles both modes)
 */
export function getSelectedSourceForFullView(state: BrowserState): import('./browse-types.js').SourceItem | null {
  return getSelectedSource(state);
}

// ============================================================================
// Pending Proposals
// ============================================================================

