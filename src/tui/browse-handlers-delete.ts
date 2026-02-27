/**
 * Browse Handlers - Delete
 *
 * Document and project deletion with confirmation.
 */

import path from 'path';

import type { BrowserState, UIComponents } from './browse-types.js';
import {
  renderList,
  renderPreview,
  updateStatus,
  buildListItems,
  getSelectedSource,
} from './browse-render.js';
import { deleteSource, getAllSources } from '../core/vector-store.js';
import { gitCommitAndPush, deleteFileAndCommit } from '../core/git.js';
import { addToBlocklist } from '../core/blocklist.js';
import { computeFileHash, findFileByHash } from '../sync/discover.js';
import { resolveSourceDir, removeFromPathIndex } from '../core/source-paths.js';
import type { SourceType } from '../core/types.js';

function startSpinner(ui: UIComponents, message: string): () => void {
  const frames = ['\u280b', '\u2819', '\u2838', '\u2834', '\u2826', '\u2807'];
  let i = 0;
  const interval = setInterval(() => {
    ui.statusBar.setContent(` {red-fg}{bold}${frames[i % frames.length]}{/bold}{/red-fg} {black-fg}{bold}${message}{/bold}{/black-fg}`);
    ui.screen.render();
    i++;
  }, 100);
  ui.statusBar.setContent(` {red-fg}{bold}${frames[0]}{/bold}{/red-fg} {black-fg}{bold}${message}{/bold}{/black-fg}`);
  ui.screen.render();
  return () => clearInterval(interval);
}

export function showDeleteConfirm(state: BrowserState, ui: UIComponents): void {
  if (state.filtered.length === 0) return;

  if (state.groupByProject && state.listItems.length > 0) {
    const item = state.listItems[state.selectedIndex];
    if (item?.type === 'header') {
      showProjectDeleteConfirm(state, ui, item);
      return;
    }
  }

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

export function cancelDelete(state: BrowserState, ui: UIComponents): void {
  state.mode = 'list';
  ui.deleteConfirm.hide();
  ui.screen.render();
}

export async function confirmDelete(
  state: BrowserState,
  ui: UIComponents,
  dbPath: string,
  dataDir: string,
  project?: string,
  sourceType?: SourceType
): Promise<void> {
  if (state.filtered.length === 0) {
    cancelDelete(state, ui);
    return;
  }

  if (state.groupByProject && state.listItems.length > 0) {
    const item = state.listItems[state.selectedIndex];
    if (item?.type === 'header') {
      await confirmProjectDelete(state, ui, dbPath, dataDir, item, project, sourceType);
      return;
    }
  }

  const source = getSelectedSource(state);
  if (!source) {
    cancelDelete(state, ui);
    return;
  }

  ui.deleteConfirm.hide();
  state.mode = 'list';
  const stopSpinner = startSpinner(ui, `Deleting "${source.title}"...`);

  try {
    const { sourcePath: originalPath, contentHash } = await deleteSource(dbPath, source.id);

    let effectiveHash = contentHash;
    const loreSourcePath = await resolveSourceDir(dataDir, source.id);
    if (!effectiveHash) {
      try {
        const { readdir: rd } = await import('fs/promises');
        const files = await rd(loreSourcePath);
        const candidate = files.find(f => f.startsWith('original.')) || files.find(f => f === 'content.md');
        if (candidate) {
          effectiveHash = await computeFileHash(path.join(loreSourcePath, candidate));
        }
      } catch {
        // No local files to hash
      }
    }

    await addToBlocklist(dataDir, effectiveHash);

    const { rm } = await import('fs/promises');
    try {
      await rm(loreSourcePath, { recursive: true });
    } catch {
      // File may not exist on disk
    }
    await removeFromPathIndex(dataDir, source.id);

    let fileToDelete = originalPath;
    if (!fileToDelete && effectiveHash) {
      fileToDelete = await findFileByHash(effectiveHash) ?? undefined;
    }
    if (fileToDelete) {
      await deleteFileAndCommit(fileToDelete, `Delete: ${source.title.slice(0, 50)}`);
    }

    await gitCommitAndPush(dataDir, `Delete source: ${source.title.slice(0, 50)}`);

    state.sources = await getAllSources(dbPath, {
      project: state.currentProject,
      source_type: state.showLogs ? 'log' : sourceType,
      exclude_source_type: state.showLogs ? undefined : 'log',
      sort_by: state.showLogs ? 'created_at' : undefined,
      limit: state.loadLimit,
    });
    state.filtered = [...state.sources];

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

    updateStatus(ui, state, state.currentProject, sourceType);
    renderList(ui, state);
    renderPreview(ui, state);

    ui.statusBar.setContent(` {black-fg}{bold}Deleted successfully{/bold}{/black-fg}`);
    ui.screen.render();

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

async function confirmProjectDelete(
  state: BrowserState,
  ui: UIComponents,
  dbPath: string,
  dataDir: string,
  header: Extract<import('./browse-types.js').ListItem, { type: 'header' }>,
  project?: string,
  sourceType?: SourceType
): Promise<void> {
  ui.deleteConfirm.hide();
  state.mode = 'list';
  const stopSpinner = startSpinner(ui, `Deleting ${header.documentCount} documents from "${header.displayName}"...`);

  try {
    const docsToDelete = state.filtered.filter(s => {
      if (header.projectName === '__unassigned__') {
        return s.projects.length === 0;
      }
      return s.projects.includes(header.projectName);
    });

    let deleted = 0;
    const errors: string[] = [];
    const deletedHashes: (string | undefined)[] = [];

    const { rm } = await import('fs/promises');
    for (const source of docsToDelete) {
      try {
        const { sourcePath: originalPath, contentHash } = await deleteSource(dbPath, source.id);

        let effectiveHash = contentHash;
        const loreSourcePath = await resolveSourceDir(dataDir, source.id);
        if (!effectiveHash) {
          try {
            const { readdir: rd } = await import('fs/promises');
            const files = await rd(loreSourcePath);
            const candidate = files.find(f => f.startsWith('original.')) || files.find(f => f === 'content.md');
            if (candidate) {
              effectiveHash = await computeFileHash(path.join(loreSourcePath, candidate));
            }
          } catch {
            // No local files to hash
          }
        }
        deletedHashes.push(effectiveHash);

        try {
          await rm(loreSourcePath, { recursive: true });
        } catch {
          // File may not exist on disk
        }
        await removeFromPathIndex(dataDir, source.id);

        let fileToDelete = originalPath;
        if (!fileToDelete && effectiveHash) {
          fileToDelete = await findFileByHash(effectiveHash) ?? undefined;
        }
        if (fileToDelete) {
          await deleteFileAndCommit(fileToDelete, `Delete: ${source.title.slice(0, 50)}`);
        }

        deleted++;
        ui.statusBar.setContent(` {yellow-fg}Deleting... ${deleted}/${docsToDelete.length}{/yellow-fg}`);
        ui.screen.render();
      } catch (err) {
        errors.push(`${source.title}: ${err}`);
      }
    }

    await addToBlocklist(dataDir, ...deletedHashes);
    await gitCommitAndPush(dataDir, `Delete project: ${header.displayName} (${deleted} documents)`);

    state.expandedProjects.delete(header.projectName);
    state.currentProject = undefined;

    state.sources = await getAllSources(dbPath, {
      source_type: state.showLogs ? 'log' : sourceType,
      exclude_source_type: state.showLogs ? undefined : 'log',
      sort_by: state.showLogs ? 'created_at' : undefined,
      limit: state.loadLimit,
    });
    state.filtered = [...state.sources];

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

    updateStatus(ui, state, state.currentProject, sourceType);
    renderList(ui, state);
    renderPreview(ui, state);

    if (errors.length > 0) {
      ui.statusBar.setContent(` {black-fg}{bold}Deleted ${deleted} documents, ${errors.length} failed{/bold}{/black-fg}`);
    } else {
      ui.statusBar.setContent(` {black-fg}{bold}Deleted ${deleted} documents{/bold}{/black-fg}`);
    }
    ui.screen.render();

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
