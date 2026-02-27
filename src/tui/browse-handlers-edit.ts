/**
 * Browse Handlers - Edit
 *
 * Document info editing and content type picker.
 */

import type { BrowserState, UIComponents } from './browse-types.js';
import {
  renderList,
  renderPreview,
  updateStatus,
  buildListItems,
  getSelectedSource,
} from './browse-render.js';
import { updateSourceTitle, updateSourceProjects, updateSourceContentType } from '../core/vector-store.js';
import type { SourceType } from '../core/types.js';

const CONTENT_TYPES = [
  'interview',
  'meeting',
  'conversation',
  'document',
  'note',
  'analysis',
] as const;

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

  ui.listPane.hide();
  ui.previewPane.hide();

  ui.askInput.setLabel(' Edit Title ');
  ui.askInput.setValue(source.title);
  ui.askInput.show();

  ui.askPane.setLabel(' Document Info ');
  ui.askPane.setContent('{cyan-fg}Edit the title above and press Enter to save{/cyan-fg}\n\n{gray-fg}Press Esc to cancel{/gray-fg}');
  ui.askPane.show();

  ui.footer.setContent(' Enter: Save │ Esc: Cancel');
  ui.askInput.focus();
  ui.askInput.readInput();
  ui.screen.render();
}

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

    if (state.editTitle !== source.title && state.editTitle.trim()) {
      const success = await updateSourceTitle(dbPath, source.id, state.editTitle.trim());
      if (success) {
        source.title = state.editTitle.trim();
        updated = true;
      }
    }

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

export function exitEditInfo(state: BrowserState, ui: UIComponents): void {
  state.mode = 'list';
  state.editSource = undefined;
  state.editTitle = '';
  state.editProjects = [];
  state.editFieldIndex = 0;

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

  const currentIdx = CONTENT_TYPES.indexOf(source.content_type as typeof CONTENT_TYPES[number]);
  if (currentIdx >= 0) {
    state.typePickerIndex = currentIdx;
  }

  state.mode = 'type-picker';
  renderTypePicker(state, ui);
  ui.projectPicker.show();
  ui.screen.render();
}

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

export function typePickerDown(state: BrowserState, ui: UIComponents): void {
  if (state.typePickerIndex < CONTENT_TYPES.length - 1) {
    state.typePickerIndex++;
    renderTypePicker(state, ui);
    ui.screen.render();
  }
}

export function typePickerUp(state: BrowserState, ui: UIComponents): void {
  if (state.typePickerIndex > 0) {
    state.typePickerIndex--;
    renderTypePicker(state, ui);
    ui.screen.render();
  }
}

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

export function cancelTypePicker(state: BrowserState, ui: UIComponents): void {
  ui.projectPicker.hide();
  state.mode = 'list';
  state.typePickerSource = undefined;
  ui.screen.render();
}
