/**
 * Event handlers and operations for the Lore Document Browser TUI
 *
 * Contains navigation, search, editor integration, and mode switching.
 */

import { spawn } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

import type { BrowserState, UIComponents, SourceDetails } from './browse-types.js';
import { formatDate, markdownToBlessed, renderFullView, renderList, renderPreview, updateStatus } from './browse-render.js';
import { getSourceById, searchSources } from '../core/vector-store.js';
import { generateEmbedding } from '../core/embedder.js';
import { searchLocalFiles } from '../core/local-search.js';
import type { SearchMode, SourceType } from '../core/types.js';

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

  const source = state.filtered[state.selectedIndex];

  // Try to load from disk first
  const contentPath = path.join(sourcesDir, source.id, 'content.md');

  try {
    const { readFile } = await import('fs/promises');
    state.fullContent = await readFile(contentPath, 'utf-8');
  } catch {
    // Fall back to database source details
    const details = await getSourceById(dbPath, source.id) as SourceDetails | null;
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
}

/**
 * Exit full view mode
 */
export function exitFullView(state: BrowserState, ui: UIComponents): void {
  state.mode = 'list';
  ui.fullViewPane.hide();
  ui.listPane.show();
  ui.previewPane.show();
  ui.footer.setContent(' j/k: navigate  Enter: view  e: editor  /: search  :: regex  q: quit  ?: help');
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

      // Convert to SourceItem format
      const sourceIds = results.map(r => r.source_id);
      state.filtered = state.sources
        .filter(s => sourceIds.includes(s.id))
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
        ui.statusBar.setContent(` No regex matches for "${query}"`);
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

/**
 * Open current document in external editor
 */
export async function openInEditor(
  state: BrowserState,
  ui: UIComponents,
  sourcesDir: string
): Promise<void> {
  if (state.filtered.length === 0) return;

  const source = state.filtered[state.selectedIndex];
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
    if (state.selectedIndex < state.filtered.length - 1) {
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
    state.selectedIndex = Math.min(state.selectedIndex + Math.floor(pageSize), state.filtered.length - 1);
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
    state.selectedIndex = state.filtered.length - 1;
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

    const result = await handleSync(dbPath, dataDir, {
      git_pull: true,
      git_push: true,
    });

    const processed = result.processing?.processed || 0;

    // Reload sources if anything was processed
    if (processed > 0) {
      state.sources = await getAllSources(dbPath, {
        project,
        source_type: sourceType,
        limit: 100,
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
