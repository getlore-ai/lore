/**
 * Browse Handlers - Viewer
 *
 * Full view mode, content loading, editor integration, help overlay.
 */

import { spawnSync } from 'child_process';
import { writeFileSync, readFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { createHash } from 'crypto';

import type { BrowserState, UIComponents, SourceDetails } from './browse-types.js';
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
import { getSourceById, addSource } from '../core/vector-store.js';
import { generateEmbedding, createSearchableText } from '../core/embedder.js';
import { extractInsights } from '../core/insight-extractor.js';
import { gitCommitAndPush } from '../core/git.js';
import { resolveSourceDir } from '../core/source-paths.js';
import type { SourceType, SourceRecord, ContentType } from '../core/types.js';

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

export async function loadFullContent(
  state: BrowserState,
  ui: UIComponents,
  dbPath: string,
  sourcesDir: string
): Promise<void> {
  if (state.filtered.length === 0) return;

  const source = getSelectedSource(state);
  if (!source) return;

  const dataDir = path.dirname(sourcesDir);
  const sourceDir = await resolveSourceDir(dataDir, source.id);
  const contentPath = path.join(sourceDir, 'content.md');

  try {
    const { readFile } = await import('fs/promises');
    const diskContent = await readFile(contentPath, 'utf-8');
    if (!diskContent.startsWith('<!-- lore:stub -->')) {
      state.fullContent = diskContent;
    } else {
      throw new Error('stub');
    }
  } catch {
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
      // Source directory doesn't exist locally
    }

    if (!foundOriginal) {
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
          // source_path file doesn't exist
        }
      }

      if (!foundOriginal) {
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

  state.fullContentLinesRaw = state.fullContent.split('\n');
  const rendered = markdownToBlessed(state.fullContent);
  state.fullContentLines = rendered.split('\n');

  state.docSearchPattern = '';
  state.docSearchMatches = [];
  state.docSearchCurrentIdx = 0;

  state.scrollOffset = 0;
  renderFullView(ui, state);
}

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

  ui.fullViewContent.setContent('{blue-fg}Loading...{/blue-fg}');
  ui.screen.render();

  await loadFullContent(state, ui, dbPath, sourcesDir);
  ui.footer.setContent(' j/k Scroll │ / Search │ y Copy │ e Edit │ Esc Back');
  ui.screen.render();
}

export function exitFullView(state: BrowserState, ui: UIComponents): void {
  state.mode = 'list';
  ui.fullViewPane.hide();
  ui.listPane.show();
  ui.previewPane.show();
  ui.footer.setContent(' j/k Nav │ / Search │ a Ask │ R Research │ p Proj │ c Type │ m Move │ i Edit │ q Quit │ ? Help');
  ui.screen.render();
}

export function showHelp(state: BrowserState, ui: UIComponents): void {
  state.mode = 'help';
  ui.helpPane.show();
  ui.screen.render();
}

export function hideHelp(state: BrowserState, ui: UIComponents): void {
  state.mode = 'list';
  ui.helpPane.hide();
  ui.screen.render();
}

export async function openInEditor(
  state: BrowserState,
  ui: UIComponents,
  sourcesDir: string,
  dbPath: string,
  dataDir: string
): Promise<void> {
  if (state.filtered.length === 0) return;

  const source = getSelectedSource(state);
  if (!source) return;

  const editorEnv = process.env.EDITOR || 'vi';
  const editorParts = editorEnv.split(/\s+/);
  const editor = editorParts[0];
  const editorArgs = editorParts.slice(1);

  let content = state.fullContent;
  if (!content) {
    const editorDataDir = path.dirname(sourcesDir);
    const editorSourceDir = await resolveSourceDir(editorDataDir, source.id);
    const contentPath = path.join(editorSourceDir, 'content.md');
    try {
      const { readFile } = await import('fs/promises');
      content = await readFile(contentPath, 'utf-8');
    } catch {
      content = source.summary;
    }
  }

  const tmpPath = path.join(tmpdir(), `lore-${source.id}.md`);
  writeFileSync(tmpPath, content);

  ui.screen.program.normalBuffer();
  ui.screen.program.showCursor();

  const editorResult = spawnSync(editor, [...editorArgs, tmpPath], {
    stdio: 'inherit',
  });

  ui.screen.program.alternateBuffer();
  ui.screen.program.hideCursor();

  if (editorResult.error) {
    try { unlinkSync(tmpPath); } catch { /* ignore */ }
    ui.screen.alloc();
    ui.screen.render();
    ui.statusBar.setContent(` {red-fg}Editor failed: ${editorResult.error.message}{/red-fg}`);
    ui.screen.render();
    return;
  }

  let editedContent: string;
  try {
    editedContent = readFileSync(tmpPath, 'utf-8');
  } catch {
    try { unlinkSync(tmpPath); } catch { /* ignore */ }
    ui.screen.alloc();
    ui.screen.render();
    ui.statusBar.setContent(' {red-fg}Could not read edited file{/red-fg}');
    ui.screen.render();
    return;
  }

  try { unlinkSync(tmpPath); } catch { /* ignore */ }

  ui.screen.alloc();

  if (editedContent === content) {
    ui.statusBar.setContent(' {gray-fg}No changes{/gray-fg}');
    ui.screen.render();
    setTimeout(() => {
      updateStatus(ui, state, state.currentProject);
      ui.screen.render();
    }, 1500);
    return;
  }

  const saveDataDir = path.dirname(sourcesDir);
  const sourceDir = await resolveSourceDir(saveDataDir, source.id);
  const contentPath = path.join(sourceDir, 'content.md');
  try {
    const { mkdir, writeFile } = await import('fs/promises');
    await mkdir(sourceDir, { recursive: true });
    await writeFile(contentPath, editedContent, 'utf-8');
  } catch (err) {
    ui.statusBar.setContent(` {red-fg}Save failed: ${err}{/red-fg}`);
    ui.screen.render();
    return;
  }

  state.fullContent = editedContent;
  state.fullContentLinesRaw = editedContent.split('\n');
  const rendered = markdownToBlessed(editedContent);
  state.fullContentLines = rendered.split('\n');
  if (state.mode === 'fullview') {
    renderFullView(ui, state);
  }

  ui.statusBar.setContent(' {yellow-fg}Saved. Re-indexing...{/yellow-fg}');
  ui.screen.render();

  reindexSource(source.id, editedContent, source, state, dbPath, dataDir, ui).catch(() => {});
}

async function reindexSource(
  sourceId: string,
  newContent: string,
  source: { title: string; source_type: string; content_type: string; projects: string[]; created_at: string },
  state: BrowserState,
  dbPath: string,
  dataDir: string,
  ui: UIComponents
): Promise<void> {
  try {
    const contentHash = createHash('sha256').update(newContent).digest('hex');

    const existing = await getSourceById(dbPath, sourceId);
    const existingTags = existing?.tags || [];

    const insights = await extractInsights(newContent, source.title, sourceId, {
      contentType: source.content_type,
    });

    const searchableText = createSearchableText({
      type: 'summary',
      text: insights.summary,
      project: source.projects[0],
    });
    const vector = await generateEmbedding(searchableText);

    const sourceRecord: SourceRecord = {
      id: sourceId,
      title: source.title,
      source_type: source.source_type as SourceType,
      content_type: source.content_type as ContentType,
      projects: JSON.stringify(source.projects),
      tags: JSON.stringify(existingTags),
      created_at: source.created_at,
      summary: insights.summary,
      themes_json: JSON.stringify(insights.themes || []),
      quotes_json: JSON.stringify(insights.quotes || []),
      has_full_content: true,
      vector: [],
    };
    await addSource(dbPath, sourceRecord, vector, { content_hash: contentHash });

    const insightsDir = await resolveSourceDir(dataDir, sourceId);
    const insightsPath = path.join(insightsDir, 'insights.json');
    try {
      const { writeFile } = await import('fs/promises');
      await writeFile(insightsPath, JSON.stringify(insights, null, 2), 'utf-8');
    } catch { /* non-critical */ }

    gitCommitAndPush(dataDir, `Edit: ${source.title.slice(0, 50)}`).catch(() => {});

    const updateItem = (item: { id: string; summary: string }) => {
      if (item.id === sourceId) {
        item.summary = insights.summary;
      }
    };
    state.sources.forEach(updateItem);
    state.filtered.forEach(updateItem);

    if (state.mode === 'list') {
      if (state.groupByProject) {
        state.listItems = buildListItems(state);
      }
      renderList(ui, state);
      renderPreview(ui, state);
    }

    ui.statusBar.setContent(` {green-fg}Re-indexed: ${source.title.slice(0, 40)}{/green-fg}`);
    ui.screen.render();
  } catch (err) {
    ui.statusBar.setContent(` {red-fg}Re-index failed: ${err}{/red-fg}`);
    ui.screen.render();
  }
}
