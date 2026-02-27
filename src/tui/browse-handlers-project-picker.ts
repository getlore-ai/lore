/**
 * Browse Handlers - Project Picker
 *
 * Project selection, filtering, sync triggering.
 */

import type { BrowserState, UIComponents, ProjectInfo } from './browse-types.js';
import {
  formatDate,
  formatRelativeTime,
  renderList,
  renderPreview,
  updateStatus,
} from './browse-render.js';
import { getProjectStats, getAllSources } from '../core/vector-store.js';
import type { SourceType } from '../core/types.js';
import { renderReturnToAskOrResearch } from './browse-handlers-viewer.js';

export async function showProjectPicker(
  state: BrowserState,
  ui: UIComponents,
  dbPath: string
): Promise<void> {
  ui.statusBar.setContent(' Loading projects...');
  ui.screen.render();

  try {
    const stats = await getProjectStats(dbPath);

    const projects: ProjectInfo[] = [];

    projects.push({
      name: '__all__',
      count: state.sources.length,
      latestActivity: new Date().toISOString(),
    });

    const unassignedCount = state.sources.filter(s => s.projects.length === 0).length;
    if (unassignedCount > 0) {
      projects.push({
        name: '__unassigned__',
        count: unassignedCount,
        latestActivity: new Date().toISOString(),
      });
    }

    for (const stat of stats) {
      projects.push({
        name: stat.project,
        count: stat.source_count,
        latestActivity: stat.latest_activity,
      });
    }

    state.projects = projects;
    state.projectPickerIndex = 0;

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

export function projectPickerDown(state: BrowserState, ui: UIComponents): void {
  if (state.projectPickerIndex < state.projects.length - 1) {
    state.projectPickerIndex++;
    renderProjectPicker(state, ui);
    ui.screen.render();
  }
}

export function projectPickerUp(state: BrowserState, ui: UIComponents): void {
  if (state.projectPickerIndex > 0) {
    state.projectPickerIndex--;
    renderProjectPicker(state, ui);
    ui.screen.render();
  }
}

export async function selectProject(
  state: BrowserState,
  ui: UIComponents,
  dbPath: string,
  dataDir: string,
  sourceType?: SourceType
): Promise<void> {
  const selected = state.projects[state.projectPickerIndex];

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
    if (newProject === '__unassigned__') {
      const allSources = await getAllSources(dbPath, {
        source_type: state.showLogs ? 'log' : sourceType,
        exclude_source_type: state.showLogs ? undefined : 'log',
        sort_by: state.showLogs ? 'created_at' : undefined,
        limit: state.loadLimit,
      });
      state.sources = allSources.filter(s => s.projects.length === 0);
    } else {
      state.sources = await getAllSources(dbPath, {
        project: newProject,
        source_type: state.showLogs ? 'log' : sourceType,
        exclude_source_type: state.showLogs ? undefined : 'log',
        sort_by: state.showLogs ? 'created_at' : undefined,
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

export function cancelProjectPicker(state: BrowserState, ui: UIComponents): void {
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
      source_type: state.showLogs ? 'log' : sourceType,
      exclude_source_type: state.showLogs ? undefined : 'log',
      sort_by: state.showLogs ? 'created_at' : undefined,
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

    if (processed > 0) {
      state.sources = await getAllSources(dbPath, {
        project,
        source_type: state.showLogs ? 'log' : sourceType,
        exclude_source_type: state.showLogs ? undefined : 'log',
        sort_by: state.showLogs ? 'created_at' : undefined,
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

    setTimeout(() => {
      updateStatus(ui, state, project, sourceType);
      ui.screen.render();
    }, 2000);
  } catch (error) {
    ui.statusBar.setContent(` {red-fg}Sync failed: ${error}{/red-fg}`);
    ui.screen.render();
  }
}
