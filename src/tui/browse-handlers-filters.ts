/**
 * Browse Handlers - Filters
 *
 * Content type filtering, log visibility toggle, grouped view, project expand/collapse.
 */

import type { BrowserState, UIComponents } from './browse-types.js';
import {
  renderList,
  renderPreview,
  updateStatus,
  buildListItems,
} from './browse-render.js';
import { getAllSources, getProjectStats } from '../core/vector-store.js';
import type { SourceType } from '../core/types.js';
import { renderReturnToAskOrResearch } from './browse-handlers-viewer.js';

const FILTER_CONTENT_TYPES = [
  '__all__',
  'interview',
  'meeting',
  'conversation',
  'document',
  'note',
  'analysis',
] as const;

export function showContentTypeFilter(state: BrowserState, ui: UIComponents): void {
  state.contentTypeFilterIndex = 0;

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

export function contentTypeFilterDown(state: BrowserState, ui: UIComponents): void {
  if (state.contentTypeFilterIndex < FILTER_CONTENT_TYPES.length - 1) {
    state.contentTypeFilterIndex++;
    renderContentTypeFilter(state, ui);
    ui.screen.render();
  }
}

export function contentTypeFilterUp(state: BrowserState, ui: UIComponents): void {
  if (state.contentTypeFilterIndex > 0) {
    state.contentTypeFilterIndex--;
    renderContentTypeFilter(state, ui);
    ui.screen.render();
  }
}

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
    state.sources = await getAllSources(dbPath, {
      project: state.currentProject,
      source_type: state.showLogs ? 'log' : sourceType,
      exclude_source_type: state.showLogs ? undefined : 'log',
      sort_by: state.showLogs ? 'created_at' : undefined,
      limit: state.loadLimit,
    });

    if (newFilter) {
      state.filtered = state.sources.filter(s => s.content_type === newFilter);
    } else {
      state.filtered = [...state.sources];
    }

    state.selectedIndex = 0;

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

export function cancelContentTypeFilter(state: BrowserState, ui: UIComponents): void {
  ui.projectPicker.hide();

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
      source_type: state.showLogs ? 'log' : sourceType,
      exclude_source_type: state.showLogs ? undefined : 'log',
      sort_by: state.showLogs ? 'created_at' : undefined,
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

export async function toggleLogs(
  state: BrowserState,
  ui: UIComponents,
  dbPath: string,
  dataDir: string,
  sourceType?: SourceType
): Promise<void> {
  state.showLogs = !state.showLogs;

  ui.listTitle.setContent(state.showLogs ? ' Logs' : ' Documents');
  ui.statusBar.setContent(state.showLogs ? ' Loading logs...' : ' Loading documents...');
  ui.screen.render();

  try {
    if (state.showLogs) {
      state.sources = await getAllSources(dbPath, {
        project: state.currentProject,
        source_type: 'log',
        sort_by: 'created_at',
        limit: state.loadLimit,
      });
      if (state.groupByProject && state.projects.length === 0) {
        const stats = await getProjectStats(dbPath);
        state.projects = stats.map(s => ({
          name: s.project,
          count: s.source_count,
          latestActivity: s.latest_activity,
        }));
      }
    } else {
      state.sources = await getAllSources(dbPath, {
        project: state.currentProject,
        source_type: sourceType,
        exclude_source_type: 'log',
        limit: state.loadLimit,
      });
    }

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
    ui.statusBar.setContent(` {red-fg}Toggle failed: ${error}{/red-fg}`);
    ui.screen.render();
  }
}

export function toggleProjectExpand(state: BrowserState, ui: UIComponents): boolean {
  if (!state.groupByProject || state.listItems.length === 0) {
    return false;
  }

  const item = state.listItems[state.selectedIndex];
  if (!item || item.type !== 'header') {
    return false;
  }

  if (state.expandedProjects.has(item.projectName)) {
    state.expandedProjects.delete(item.projectName);
  } else {
    state.expandedProjects.add(item.projectName);
  }

  state.listItems = buildListItems(state);
  renderList(ui, state);
  renderPreview(ui, state);
  ui.screen.render();
  return true;
}

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

export function collapseCurrentProject(state: BrowserState, ui: UIComponents): void {
  if (!state.groupByProject || state.listItems.length === 0) return;

  const item = state.listItems[state.selectedIndex];
  if (!item) return;

  const projectName = item.type === 'header' ? item.projectName : item.projectName;

  if (state.expandedProjects.has(projectName)) {
    state.expandedProjects.delete(projectName);

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

export function toggleGroupedView(state: BrowserState, ui: UIComponents): void {
  state.groupByProject = !state.groupByProject;

  if (state.groupByProject) {
    state.listItems = buildListItems(state);
    state.selectedIndex = 0;
  } else {
    state.listItems = [];
    state.selectedIndex = 0;
  }

  renderList(ui, state);
  renderPreview(ui, state);
  ui.screen.render();
}

export function isDocumentSelected(state: BrowserState): boolean {
  if (!state.groupByProject) {
    return state.filtered.length > 0;
  }

  const item = state.listItems[state.selectedIndex];
  return item?.type === 'document';
}

