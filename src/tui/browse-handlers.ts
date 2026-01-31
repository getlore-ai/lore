/**
 * Event handlers and operations for the Lore Document Browser TUI
 *
 * Contains navigation, search, editor integration, and mode switching.
 */

import { spawn } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

import type { BrowserState, UIComponents, SourceDetails, ProjectInfo, ToolFormField } from './browse-types.js';
import {
  formatDate,
  markdownToBlessed,
  renderFullView,
  renderList,
  renderPreview,
  renderPendingList,
  renderPendingPreview,
  renderToolsList,
  renderToolForm,
  renderToolResult,
  updateStatus,
} from './browse-render.js';
import { getSourceById, searchSources, getProjectStats, getAllSources } from '../core/vector-store.js';
import { generateEmbedding } from '../core/embedder.js';
import { searchLocalFiles } from '../core/local-search.js';
import type { SearchMode, SourceType } from '../core/types.js';
import { getExtensionRegistry } from '../extensions/registry.js';
import { listPendingProposals, approveProposal, rejectProposal } from '../extensions/proposals.js';

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
  ui.footer.setContent(' ↑↓ Navigate  │  Enter View  │  / Search  │  p Projects  │  t Tools  │  P Pending  │  e Editor  │  q Quit  │  ? Help');
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

// ============================================================================
// Tools View
// ============================================================================

export function parseInputSchema(inputSchema: Record<string, unknown>): ToolFormField[] {
  if (!inputSchema || typeof inputSchema !== 'object') return [];

  const schema = inputSchema as {
    type?: string;
    properties?: Record<string, unknown>;
    required?: string[];
  };
  const properties = schema.properties && typeof schema.properties === 'object'
    ? schema.properties as Record<string, any>
    : {};
  const required = Array.isArray(schema.required) ? schema.required : [];

  const fields: ToolFormField[] = [];

  for (const [name, prop] of Object.entries(properties)) {
    const propType = typeof prop === 'object' && prop ? prop.type : undefined;
    let type: ToolFormField['type'] = 'string';
    if (propType === 'number' || propType === 'integer') {
      type = 'number';
    } else if (propType === 'boolean') {
      type = 'boolean';
    } else if (propType === 'string') {
      type = 'string';
    }

    const description = typeof prop?.description === 'string' ? prop.description : '';
    const defaultValue = prop?.default;

    let value: ToolFormField['value'];
    if (defaultValue !== undefined) {
      if (type === 'boolean') {
        value = Boolean(defaultValue);
      } else if (type === 'number') {
        const numeric = typeof defaultValue === 'number' ? defaultValue : Number(defaultValue);
        value = Number.isNaN(numeric) ? '' : numeric;
      } else {
        value = String(defaultValue);
      }
    } else if (type === 'boolean') {
      value = false;
    } else {
      value = '';
    }

    fields.push({
      name,
      type,
      description,
      default: defaultValue,
      required: required.includes(name),
      value,
    });
  }

  return fields;
}

function setToolFormFields(state: BrowserState, tool?: { inputSchema?: Record<string, unknown> }): void {
  if (!tool || !tool.inputSchema) {
    state.toolFormFields = [];
    state.toolFormIndex = 0;
    return;
  }
  state.toolFormFields = parseInputSchema(tool.inputSchema);
  state.toolFormIndex = 0;
}

export async function showTools(state: BrowserState, ui: UIComponents): Promise<void> {
  state.mode = 'tools';
  state.toolResult = null;
  ui.toolForm.hide();
  ui.fullViewPane.hide();
  ui.listPane.show();
  ui.previewPane.show();
  ui.listTitle.setContent(' Tools');
  ui.previewTitle.setContent(' Tool Details');
  ui.footer.setContent(' j/k: navigate  Enter: run  Esc: back  q: quit');
  ui.statusBar.setContent(' Loading tools...');
  ui.screen.render();

  try {
    const registry = await getExtensionRegistry();
    state.toolsList = registry.getToolDefinitions();
    state.selectedToolIndex = 0;
    ui.statusBar.setContent(` ${state.toolsList.length} tool${state.toolsList.length !== 1 ? 's' : ''}`);
    setToolFormFields(state, state.toolsList[state.selectedToolIndex]);
  } catch (error) {
    state.toolsList = [];
    state.selectedToolIndex = 0;
    state.toolFormFields = [];
    state.toolFormIndex = 0;
    ui.statusBar.setContent(` {red-fg}Failed to load tools: ${error}{/red-fg}`);
  }

  renderToolsList(ui, state);
  renderToolResult(ui, state);
  ui.listContent.focus();
  ui.screen.render();
}

export function selectTool(state: BrowserState, ui: UIComponents): void {
  const tool = state.toolsList[state.selectedToolIndex];
  setToolFormFields(state, tool);
  renderToolsList(ui, state);
  renderToolResult(ui, state);
  if (!ui.toolForm.hidden) {
    renderToolForm(ui, state);
  }
  ui.screen.render();
}

export function showToolForm(state: BrowserState, ui: UIComponents): void {
  const tool = state.toolsList[state.selectedToolIndex];
  if (!tool) return;

  setToolFormFields(state, tool);
  ui.toolForm.setLabel(` ${tool.name} `);
  ui.toolForm.show();
  renderToolForm(ui, state);
  ui.footer.setContent(' Tab: next field  Enter: run  Esc: back');
  ui.screen.render();
}

export function hideToolForm(state: BrowserState, ui: UIComponents): void {
  ui.toolForm.hide();
  ui.footer.setContent(' j/k: navigate  Enter: run  Esc: back  q: quit');
  ui.screen.render();
}

export function formFieldNext(state: BrowserState, ui: UIComponents): void {
  if (state.toolFormFields.length === 0) return;
  state.toolFormIndex = (state.toolFormIndex + 1) % state.toolFormFields.length;
  renderToolForm(ui, state);
  ui.screen.render();
}

export function formFieldPrev(state: BrowserState, ui: UIComponents): void {
  if (state.toolFormFields.length === 0) return;
  state.toolFormIndex = (state.toolFormIndex - 1 + state.toolFormFields.length) % state.toolFormFields.length;
  renderToolForm(ui, state);
  ui.screen.render();
}

export function formFieldUpdate(state: BrowserState, ui: UIComponents, value: ToolFormField['value']): void {
  const field = state.toolFormFields[state.toolFormIndex];
  if (!field) return;
  field.value = value;
  renderToolForm(ui, state);
  ui.screen.render();
}

export async function callTool(
  state: BrowserState,
  ui: UIComponents,
  dbPath: string,
  dataDir: string
): Promise<boolean> {
  const tool = state.toolsList[state.selectedToolIndex];
  if (!tool) return false;

  const args: Record<string, unknown> = {};
  const missing: string[] = [];

  for (const field of state.toolFormFields) {
    if (field.type === 'boolean') {
      const value = Boolean(field.value);
      if (value || field.required || field.default !== undefined) {
        args[field.name] = value;
      }
      continue;
    }

    if (field.type === 'number') {
      const raw = field.value === undefined || field.value === null ? '' : String(field.value);
      if (!raw.trim()) {
        if (field.required) missing.push(field.name);
        continue;
      }
      const numeric = Number(raw);
      if (Number.isNaN(numeric)) {
        state.toolResult = {
          toolName: tool.name,
          ok: false,
          result: `Invalid number for "${field.name}"`,
        };
        renderToolResult(ui, state);
        ui.screen.render();
        return false;
      }
      args[field.name] = numeric;
      continue;
    }

    const text = field.value === undefined || field.value === null ? '' : String(field.value);
    if (!text.trim()) {
      if (field.required) missing.push(field.name);
      continue;
    }
    args[field.name] = text;
  }

  if (missing.length > 0) {
    state.toolResult = {
      toolName: tool.name,
      ok: false,
      result: `Missing required field(s): ${missing.join(', ')}`,
    };
    renderToolResult(ui, state);
    ui.screen.render();
    return false;
  }

  state.toolRunning = true;
  state.toolStartTime = Date.now();
  ui.statusBar.setContent(` ⏳ Running ${tool.name}...`);
  ui.screen.render();

  try {
    const registry = await getExtensionRegistry();
    const result = await registry.handleToolCall(tool.name, args, {
      mode: 'cli',
      dataDir,
      dbPath,
      // Silence extension logs in TUI mode
      logger: () => {},
    });

    state.toolRunning = false;
    state.toolStartTime = null;

    if (!result.handled) {
      state.toolResult = {
        toolName: tool.name,
        ok: false,
        result: 'Tool not found',
      };
      ui.statusBar.setContent(` {red-fg}✗ ${tool.name}: Tool not found{/red-fg}`);
    } else {
      state.toolResult = {
        toolName: tool.name,
        ok: true,
        result: result.result,
      };
      ui.statusBar.setContent(` {green-fg}✓ ${tool.name} complete{/green-fg}`);
    }
  } catch (error) {
    state.toolRunning = false;
    state.toolStartTime = null;
    state.toolResult = {
      toolName: tool.name,
      ok: false,
      result: error instanceof Error ? error.message : String(error),
    };
    ui.statusBar.setContent(` {red-fg}✗ ${tool.name} failed{/red-fg}`);
  }

  renderToolResult(ui, state);
  ui.screen.render();
  return true;
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
  } else if (state.mode === 'pending') {
    if (state.selectedPendingIndex < state.pendingList.length - 1) {
      state.selectedPendingIndex++;
      renderPendingList(ui, state);
      renderPendingPreview(ui, state);
    }
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
  } else if (state.mode === 'pending') {
    if (state.selectedPendingIndex > 0) {
      state.selectedPendingIndex--;
      renderPendingList(ui, state);
      renderPendingPreview(ui, state);
    }
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
  } else if (state.mode === 'pending') {
    state.selectedPendingIndex = Math.min(
      state.selectedPendingIndex + Math.floor(pageSize),
      state.pendingList.length - 1
    );
    renderPendingList(ui, state);
    renderPendingPreview(ui, state);
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
  } else if (state.mode === 'pending') {
    state.selectedPendingIndex = Math.max(state.selectedPendingIndex - Math.floor(pageSize), 0);
    renderPendingList(ui, state);
    renderPendingPreview(ui, state);
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
  } else if (state.mode === 'pending') {
    state.selectedPendingIndex = Math.max(0, state.pendingList.length - 1);
    renderPendingList(ui, state);
    renderPendingPreview(ui, state);
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
  } else if (state.mode === 'pending') {
    state.selectedPendingIndex = 0;
    renderPendingList(ui, state);
    renderPendingPreview(ui, state);
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
  state.mode = 'list';

  let newProject: string | undefined;

  if (selected.name === '__all__') {
    newProject = undefined;
  } else if (selected.name === '__unassigned__') {
    newProject = '__unassigned__';
  } else {
    newProject = selected.name;
  }

  state.currentProject = newProject;

  // Reload sources with new project filter
  ui.statusBar.setContent(' Filtering...');
  ui.screen.render();

  try {
    if (newProject === '__unassigned__') {
      // Special case: filter for docs with no project
      const allSources = await getAllSources(dbPath, {
        source_type: sourceType,
        limit: 100,
      });
      state.sources = allSources.filter(s => s.projects.length === 0);
    } else {
      state.sources = await getAllSources(dbPath, {
        project: newProject,
        source_type: sourceType,
        limit: 100,
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
  state.mode = 'list';
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
      limit: 100,
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
// Pending Proposals
// ============================================================================

export async function showPendingView(
  state: BrowserState,
  ui: UIComponents,
  dbPath: string,
  dataDir: string
): Promise<void> {
  ui.statusBar.setContent(' Loading pending proposals...');
  ui.screen.render();

  state.pendingList = await listPendingProposals();
  state.selectedPendingIndex = 0;
  state.mode = 'pending';
  state.pendingConfirmAction = null;

  ui.listTitle.setContent(' Pending');
  ui.previewTitle.setContent(' Proposal');
  ui.footer.setContent(' ↑↓ Navigate  │  a Approve  │  r Reject  │  Esc Back');

  renderPendingList(ui, state);
  renderPendingPreview(ui, state);
  updateStatus(ui, state);
  ui.screen.render();
}

export async function refreshPendingView(
  state: BrowserState,
  ui: UIComponents
): Promise<void> {
  state.pendingList = await listPendingProposals();
  if (state.selectedPendingIndex >= state.pendingList.length) {
    state.selectedPendingIndex = Math.max(0, state.pendingList.length - 1);
  }
  renderPendingList(ui, state);
  renderPendingPreview(ui, state);
  updateStatus(ui, state);
  ui.screen.render();
}

function confirmPendingAction(
  state: BrowserState,
  ui: UIComponents,
  prompt: string,
  onConfirm: () => Promise<void>
): void {
  state.pendingConfirmAction = prompt.includes('Reject') ? 'reject' : 'approve';
  ui.statusBar.setContent(` ${prompt} (y/n)`);
  ui.screen.render();

  const handler = async (_ch: string | undefined, key: { name?: string }) => {
    if (!key?.name) return;
    if (key.name === 'y') {
      ui.screen.removeListener('keypress', handler);
      state.pendingConfirmAction = null;
      await onConfirm();
      return;
    }
    if (key.name === 'n' || key.name === 'escape') {
      ui.screen.removeListener('keypress', handler);
      state.pendingConfirmAction = null;
      updateStatus(ui, state);
      renderPendingPreview(ui, state);
      ui.screen.render();
    }
  };

  ui.screen.on('keypress', handler);
}

export function approveSelectedProposal(
  state: BrowserState,
  ui: UIComponents,
  dbPath: string,
  dataDir: string
): void {
  const proposal = state.pendingList[state.selectedPendingIndex];
  if (!proposal || proposal.status !== 'pending') return;

  confirmPendingAction(state, ui, 'Approve proposal', async () => {
    await approveProposal(proposal.id, dbPath, dataDir);
    await refreshPendingView(state, ui);
    ui.statusBar.setContent(` {green-fg}Approved ${proposal.id}{/green-fg}`);
    ui.screen.render();
    setTimeout(() => {
      updateStatus(ui, state);
      ui.screen.render();
    }, 1200);
  });
}

export function rejectSelectedProposal(
  state: BrowserState,
  ui: UIComponents
): void {
  const proposal = state.pendingList[state.selectedPendingIndex];
  if (!proposal || proposal.status !== 'pending') return;

  confirmPendingAction(state, ui, 'Reject proposal', async () => {
    await rejectProposal(proposal.id, 'Rejected in TUI');
    await refreshPendingView(state, ui);
    ui.statusBar.setContent(` {yellow-fg}Rejected ${proposal.id}{/yellow-fg}`);
    ui.screen.render();
    setTimeout(() => {
      updateStatus(ui, state);
      ui.screen.render();
    }, 1200);
  });
}
