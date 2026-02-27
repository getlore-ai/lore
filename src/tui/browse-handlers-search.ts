/**
 * Browse Handlers - Search
 *
 * Search modes: semantic/hybrid, regex, document in-view search.
 */

import type { BrowserState, UIComponents } from './browse-types.js';
import {
  renderFullView,
  renderList,
  renderPreview,
  updateStatus,
  buildListItems,
} from './browse-render.js';
import { searchSources } from '../core/vector-store.js';
import { generateEmbedding } from '../core/embedder.js';
import { searchLocalFiles } from '../core/local-search.js';
import type { SearchMode, SourceType } from '../core/types.js';

export function enterSearch(state: BrowserState, ui: UIComponents): void {
  state.mode = 'search';
  state.searchMode = 'hybrid';
  ui.searchInput.show();
  ui.searchInput.setValue('/');
  ui.searchInput.focus();
  ui.screen.render();
}

export function enterRegexSearch(state: BrowserState, ui: UIComponents): void {
  state.mode = 'regex-search';
  state.searchMode = 'regex';
  ui.regexInput.show();
  ui.regexInput.setValue(':');
  ui.regexInput.focus();
  ui.screen.render();
}

export function exitSearch(state: BrowserState, ui: UIComponents): void {
  state.mode = 'list';
  ui.searchInput.hide();
  ui.regexInput.hide();
  ui.docSearchInput.hide();
  ui.listContent.focus();
  ui.screen.render();
}

export function enterDocSearch(state: BrowserState, ui: UIComponents): void {
  state.mode = 'doc-search';
  ui.docSearchInput.show();
  ui.docSearchInput.setValue('/');
  ui.docSearchInput.focus();
  ui.screen.render();
}

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

    for (let i = 0; i < state.fullContentLinesRaw.length; i++) {
      if (regex.test(state.fullContentLinesRaw[i])) {
        state.docSearchMatches.push(i);
      }
      regex.lastIndex = 0;
    }

    if (state.docSearchMatches.length > 0) {
      scrollToMatch(state, ui, 0);
    } else {
      renderFullView(ui, state);
    }
  } catch {
    state.docSearchMatches = [];
    renderFullView(ui, state);
  }
}

export function scrollToMatch(state: BrowserState, ui: UIComponents, matchIdx: number): void {
  if (state.docSearchMatches.length === 0) return;

  state.docSearchCurrentIdx = matchIdx;
  const matchLine = state.docSearchMatches[matchIdx];
  const height = (ui.fullViewContent.height as number) - 1;

  state.scrollOffset = Math.max(0, matchLine - Math.floor(height / 2));
  state.scrollOffset = Math.min(state.scrollOffset, Math.max(0, state.fullContentLines.length - height));

  renderFullView(ui, state);
}

export function nextMatch(state: BrowserState, ui: UIComponents): void {
  if (state.docSearchMatches.length === 0) return;
  const nextIdx = (state.docSearchCurrentIdx + 1) % state.docSearchMatches.length;
  scrollToMatch(state, ui, nextIdx);
}

export function prevMatch(state: BrowserState, ui: UIComponents): void {
  if (state.docSearchMatches.length === 0) return;
  const prevIdx = (state.docSearchCurrentIdx - 1 + state.docSearchMatches.length) % state.docSearchMatches.length;
  scrollToMatch(state, ui, prevIdx);
}

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
    state.searchMode = 'hybrid';
  } else if (filterMode === 'regex') {
    ui.statusBar.setContent(` Regex search "${query}"...`);
    ui.screen.render();

    try {
      const results = await searchLocalFiles(dataDir, query, {
        maxTotalResults: 50,
        maxMatchesPerFile: 5,
      });

      const sourceIds = results.map(r => r.source_id);
      state.filtered = state.sources
        .filter(s => {
          if (!sourceIds.includes(s.id)) return false;
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
    ui.statusBar.setContent(` Searching "${query}"...`);
    ui.screen.render();

    try {
      const queryVector = await generateEmbedding(query);
      const results = await searchSources(dbPath, queryVector, {
        limit: 50,
        project,
        source_type: sourceType,
        mode: filterMode,
        queryText: query,
      });

      const filtered = state.showLogs
        ? results.filter(r => r.source_type === 'log')
        : results.filter(r => r.source_type !== 'log');

      state.filtered = filtered
        .sort((a, b) => b.score - a.score)
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
