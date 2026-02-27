/**
 * Browse Handlers - Move & Copy
 *
 * Moving documents between projects and clipboard copy.
 */

import { spawn } from 'child_process';

import type { BrowserState, UIComponents, ProjectInfo } from './browse-types.js';
import {
  formatRelativeTime,
  renderList,
  renderPreview,
  updateStatus,
  buildListItems,
  getSelectedSource,
} from './browse-render.js';
import { getProjectStats, updateSourceProjects } from '../core/vector-store.js';
import type { SourceType } from '../core/types.js';

function copyToClipboard(text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const platform = process.platform;
    let cmd: string;
    let args: string[];

    if (platform === 'darwin') {
      cmd = 'pbcopy';
      args = [];
    } else if (platform === 'linux') {
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

export async function showMovePicker(
  state: BrowserState,
  ui: UIComponents,
  dbPath: string
): Promise<void> {
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

    const projects: ProjectInfo[] = [];

    projects.push({
      name: '__new__',
      count: 0,
      latestActivity: new Date().toISOString(),
    });

    for (const stat of stats) {
      projects.push({
        name: stat.project,
        count: stat.source_count,
        latestActivity: stat.latest_activity,
      });
    }

    state.movePickerProjects = projects;
    state.movePickerIndex = 0;

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

export function movePickerDown(state: BrowserState, ui: UIComponents): void {
  if (state.movePickerIndex < state.movePickerProjects.length - 1) {
    state.movePickerIndex++;
    renderMovePicker(state, ui);
    ui.screen.render();
  }
}

export function movePickerUp(state: BrowserState, ui: UIComponents): void {
  if (state.movePickerIndex > 0) {
    state.movePickerIndex--;
    renderMovePicker(state, ui);
    ui.screen.render();
  }
}

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

  if (selected.name === '__new__') {
    ui.projectPicker.hide();
    state.mode = 'list';
    ui.statusBar.setContent(' {yellow-fg}New project creation coming soon. Use edit (i) to set project name.{/yellow-fg}');
    ui.screen.render();
    setTimeout(() => {
      updateStatus(ui, state, state.currentProject, sourceType);
      ui.screen.render();
    }, 2000);
    return;
  }

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
    const success = await updateSourceProjects(dbPath, source.id, [selected.name]);

    if (!success) {
      throw new Error('Failed to update source');
    }

    source.projects = [selected.name];

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

export function cancelMovePicker(state: BrowserState, ui: UIComponents): void {
  ui.projectPicker.hide();
  state.mode = 'list';
  state.moveTargetSource = undefined;
  ui.screen.render();
}
