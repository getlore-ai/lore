/**
 * Lore Document Browser TUI
 *
 * A Tig-like terminal UI for browsing the knowledge repository.
 * Features:
 * - Split-pane layout with document list and preview
 * - Vim-style navigation (j/k, gg, G)
 * - Full document view with scrolling
 * - Editor integration
 * - Search/filter (hybrid and regex)
 */

import path from 'path';

import type { BrowseOptions, BrowserState } from './browse-types.js';
import { createUIComponents } from './browse-ui.js';
import { updateStatus, renderList, renderPreview } from './browse-render.js';
import {
  enterFullView,
  exitFullView,
  enterSearch,
  enterRegexSearch,
  exitSearch,
  enterDocSearch,
  exitDocSearch,
  applyDocSearch,
  nextMatch,
  prevMatch,
  applyFilter,
  showHelp,
  hideHelp,
  openInEditor,
  moveDown,
  moveUp,
  pageDown,
  pageUp,
  jumpToEnd,
  jumpToStart,
  triggerSync,
  showProjectPicker,
  projectPickerDown,
  projectPickerUp,
  selectProject,
  cancelProjectPicker,
  clearProjectFilter,
} from './browse-handlers.js';
import {
  showTools,
  selectTool,
  showToolForm,
  hideToolForm,
  callTool,
  formFieldNext,
  formFieldPrev,
  formFieldUpdate,
} from './browse-handlers-tools.js';
import {
  showPendingView,
  approveSelectedProposal,
  rejectSelectedProposal,
  refreshPendingView,
} from './browse-handlers-pending.js';
import { getAllSources } from '../core/vector-store.js';

/**
 * Start the document browser TUI
 */
export async function startBrowser(options: BrowseOptions): Promise<void> {
  const { project, sourceType, limit = 100, dataDir } = options;
  const dbPath = path.join(dataDir, 'lore.lance');
  const sourcesDir = path.join(dataDir, 'sources');

  // Initialize state
  const state: BrowserState = {
    sources: [],
    filtered: [],
    selectedIndex: 0,
    mode: 'list',
    searchQuery: '',
    searchMode: 'hybrid',
    scrollOffset: 0,
    fullContent: '',
    fullContentLines: [],
    fullContentLinesRaw: [],
    gPressed: false,
    docSearchPattern: '',
    docSearchMatches: [],
    docSearchCurrentIdx: 0,
    projects: [],
    projectPickerIndex: 0,
    currentProject: project, // Start with CLI-provided project filter
    toolsList: [],
    selectedToolIndex: 0,
    toolResult: null,
    toolRunning: false,
    toolStartTime: null,
    toolFormFields: [],
    toolFormIndex: 0,
    pendingList: [],
    selectedPendingIndex: 0,
    pendingConfirmAction: null,
  };

  // Create UI components
  const ui = createUIComponents();
  const { screen, helpPane, searchInput, regexInput, docSearchInput, listContent, toolForm } = ui;

  // Spinner animation for long-running tools
  const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let spinnerIdx = 0;
  const spinnerInterval = setInterval(() => {
    if (state.toolRunning && state.toolStartTime) {
      const elapsed = Math.floor((Date.now() - state.toolStartTime) / 1000);
      const spinner = spinnerFrames[spinnerIdx % spinnerFrames.length];
      spinnerIdx++;
      const tool = state.toolsList[state.selectedToolIndex];
      const toolName = tool?.name || 'tool';
      ui.statusBar.setContent(` ${spinner} Running ${toolName}... (${elapsed}s)`);
      screen.render();
    }
  }, 100);

  // Cleanup on exit
  screen.on('destroy', () => {
    clearInterval(spinnerInterval);
  });

  // Key bindings
  screen.key(['q'], () => {
    if (state.mode === 'help') {
      hideHelp(state, ui);
    } else {
      screen.destroy();
      process.exit(0);
    }
  });

  screen.key(['?'], () => {
    if (state.mode === 'help') {
      hideHelp(state, ui);
    } else if (state.mode === 'list') {
      showHelp(state, ui);
    }
  });

  screen.key(['escape'], () => {
    if (!toolForm.hidden) {
      hideToolForm(state, ui);
      listContent.focus();
      screen.render();
      return;
    }
    if (state.mode === 'fullview') {
      if (state.docSearchPattern) {
        // Clear document search first
        exitDocSearch(state, ui, true);
      } else {
        exitFullView(state, ui);
      }
    } else if (state.mode === 'doc-search') {
      exitDocSearch(state, ui, false);
    } else if (state.mode === 'search' || state.mode === 'regex-search') {
      exitSearch(state, ui);
    } else if (state.mode === 'help') {
      hideHelp(state, ui);
    } else if (state.mode === 'project-picker') {
      cancelProjectPicker(state, ui);
    } else if (state.mode === 'tools') {
      state.mode = 'list';
      ui.listTitle.setContent(' Documents');
      ui.previewTitle.setContent(' Preview');
      ui.footer.setContent(' ↑↓ Navigate  │  Enter View  │  / Search  │  p Projects  │  t Tools  │  P Pending  │  e Editor  │  q Quit  │  ? Help');
      updateStatus(ui, state, state.currentProject, sourceType);
      renderList(ui, state);
      renderPreview(ui, state);
      screen.render();
    } else if (state.mode === 'pending') {
      state.mode = 'list';
      ui.listTitle.setContent(' Documents');
      ui.previewTitle.setContent(' Preview');
      ui.footer.setContent(' ↑↓ Navigate  │  Enter View  │  / Search  │  p Projects  │  t Tools  │  P Pending  │  e Editor  │  q Quit  │  ? Help');
      updateStatus(ui, state, state.currentProject, sourceType);
      renderList(ui, state);
      renderPreview(ui, state);
      screen.render();
    } else if (state.mode === 'list' && state.searchQuery) {
      // Clear search filter
      applyFilter(state, ui, '', 'hybrid', dbPath, dataDir, state.currentProject, sourceType);
      screen.render();
    }
  });

  screen.key(['j', 'down'], () => {
    if (state.pendingConfirmAction) return;
    if (!toolForm.hidden) return;
    if (state.mode === 'project-picker') {
      projectPickerDown(state, ui);
    } else if (state.mode === 'tools') {
      if (state.selectedToolIndex < state.toolsList.length - 1) {
        state.selectedToolIndex++;
        selectTool(state, ui);
      }
    } else if (state.mode !== 'search' && state.mode !== 'help') {
      state.gPressed = false;
      moveDown(state, ui);
    }
  });

  screen.key(['k', 'up'], () => {
    if (state.pendingConfirmAction) return;
    if (!toolForm.hidden) return;
    if (state.mode === 'project-picker') {
      projectPickerUp(state, ui);
    } else if (state.mode === 'tools') {
      if (state.selectedToolIndex > 0) {
        state.selectedToolIndex--;
        selectTool(state, ui);
      }
    } else if (state.mode !== 'search' && state.mode !== 'help') {
      state.gPressed = false;
      moveUp(state, ui);
    }
  });

  screen.key(['C-d'], () => {
    if (state.pendingConfirmAction) return;
    if (!toolForm.hidden) return;
    if (state.mode !== 'search' && state.mode !== 'help' && state.mode !== 'tools') {
      state.gPressed = false;
      pageDown(state, ui);
    }
  });

  screen.key(['C-u', 'pageup'], () => {
    if (state.pendingConfirmAction) return;
    if (!toolForm.hidden) return;
    if (state.mode !== 'search' && state.mode !== 'help' && state.mode !== 'tools') {
      state.gPressed = false;
      pageUp(state, ui);
    }
  });

  screen.key(['pagedown'], () => {
    if (state.pendingConfirmAction) return;
    if (!toolForm.hidden) return;
    if (state.mode !== 'search' && state.mode !== 'help' && state.mode !== 'tools') {
      state.gPressed = false;
      pageDown(state, ui);
    }
  });

  screen.key(['home'], () => {
    if (state.pendingConfirmAction) return;
    if (!toolForm.hidden) return;
    if (state.mode !== 'search' && state.mode !== 'help' && state.mode !== 'tools') {
      state.gPressed = false;
      jumpToStart(state, ui);
    }
  });

  screen.key(['end', 'S-g'], () => {
    if (state.pendingConfirmAction) return;
    if (!toolForm.hidden) return;
    if (state.mode !== 'search' && state.mode !== 'help' && state.mode !== 'tools') {
      state.gPressed = false;
      jumpToEnd(state, ui);
    }
  });

  screen.key(['g'], () => {
    if (state.pendingConfirmAction) return;
    if (!toolForm.hidden) return;
    if (state.mode !== 'search' && state.mode !== 'help' && state.mode !== 'tools') {
      if (state.gPressed) {
        jumpToStart(state, ui);
        state.gPressed = false;
      } else {
        state.gPressed = true;
        // Reset after 500ms
        setTimeout(() => { state.gPressed = false; }, 500);
      }
    }
  });

  screen.key(['enter'], async () => {
    if (state.pendingConfirmAction) return;
    if (!toolForm.hidden) {
      const ran = await callTool(state, ui, dbPath, dataDir);
      if (ran) {
        hideToolForm(state, ui);
      }
      return;
    }
    if (state.mode === 'list') {
      await enterFullView(state, ui, dbPath, sourcesDir);
    } else if (state.mode === 'project-picker') {
      await selectProject(state, ui, dbPath, dataDir, sourceType);
    } else if (state.mode === 'tools') {
      selectTool(state, ui);
      showToolForm(state, ui);
    } else if (state.mode === 'pending') {
      await refreshPendingView(state, ui);
    }
  });

  screen.key(['/'], () => {
    if (state.pendingConfirmAction) return;
    if (state.mode === 'list') {
      enterSearch(state, ui);
    } else if (state.mode === 'fullview') {
      enterDocSearch(state, ui);
    }
  });

  screen.key([':'], () => {
    if (state.pendingConfirmAction) return;
    if (state.mode === 'list') {
      enterRegexSearch(state, ui);
    }
  });

  screen.key(['n'], () => {
    if (state.pendingConfirmAction) return;
    if (state.mode === 'fullview' && state.docSearchMatches.length > 0) {
      nextMatch(state, ui);
    }
  });

  screen.key(['S-n'], () => {
    if (state.pendingConfirmAction) return;
    if (state.mode === 'fullview' && state.docSearchMatches.length > 0) {
      prevMatch(state, ui);
    }
  });

  screen.key(['e'], () => {
    if (state.pendingConfirmAction) return;
    if (!toolForm.hidden && state.mode !== 'tools') return;
    if (state.mode === 'list' || state.mode === 'fullview') {
      openInEditor(state, ui, sourcesDir);
    }
  });

  screen.key(['s'], () => {
    if (state.pendingConfirmAction) return;
    if (state.mode === 'list') {
      triggerSync(state, ui, dbPath, dataDir, state.currentProject, sourceType);
    }
  });

  // Project picker keybindings
  screen.key(['p'], () => {
    if (state.pendingConfirmAction) return;
    if (!toolForm.hidden) return;
    if (state.mode === 'list') {
      showProjectPicker(state, ui, dbPath);
    } else if (state.mode === 'project-picker') {
      // In picker, 'p' also closes (toggle behavior)
      cancelProjectPicker(state, ui);
    }
  });

  screen.key(['C-p'], () => {
    if (state.pendingConfirmAction) return;
    if (!toolForm.hidden) return;
    if (state.mode === 'list') {
      clearProjectFilter(state, ui, dbPath, dataDir, sourceType);
    }
  });

  screen.key(['t'], () => {
    if (state.pendingConfirmAction) return;
    if (!toolForm.hidden) return;
    if (state.mode === 'list') {
      showTools(state, ui);
    }
  });

  screen.key(['P'], () => {
    if (state.pendingConfirmAction) return;
    if (!toolForm.hidden) return;
    // Allow switching to pending from list or tools view
    if (state.mode === 'list' || state.mode === 'tools') {
      showPendingView(state, ui, dbPath, dataDir);
    }
  });

  screen.key(['a'], () => {
    if (state.pendingConfirmAction) return;
    if (state.mode === 'pending') {
      approveSelectedProposal(state, ui, dbPath, dataDir);
    }
  });

  screen.key(['r'], () => {
    if (state.pendingConfirmAction) return;
    if (state.mode === 'pending') {
      rejectSelectedProposal(state, ui);
    }
  });

  screen.key(['tab'], () => {
    if (state.pendingConfirmAction) return;
    if (!toolForm.hidden) {
      formFieldNext(state, ui);
    }
  });

  screen.key(['S-tab'], () => {
    if (state.pendingConfirmAction) return;
    if (!toolForm.hidden) {
      formFieldPrev(state, ui);
    }
  });

  screen.key(['backspace', 'delete'], () => {
    if (state.pendingConfirmAction) return;
    if (toolForm.hidden) return;
    const field = state.toolFormFields[state.toolFormIndex];
    if (!field || field.type === 'boolean') return;
    const current = field.value === undefined || field.value === null ? '' : String(field.value);
    formFieldUpdate(state, ui, current.slice(0, -1));
  });

  screen.key(['space'], () => {
    if (state.pendingConfirmAction) return;
    if (toolForm.hidden) return;
    const field = state.toolFormFields[state.toolFormIndex];
    if (!field) return;
    if (field.type === 'boolean') {
      formFieldUpdate(state, ui, !Boolean(field.value));
    } else {
      const current = field.value === undefined || field.value === null ? '' : String(field.value);
      formFieldUpdate(state, ui, `${current} `);
    }
  });

  screen.on('keypress', (ch: string | undefined, key: { name?: string; ctrl?: boolean; meta?: boolean; shift?: boolean }) => {
    if (state.pendingConfirmAction) return;
    if (toolForm.hidden) return;
    if (!ch || key?.ctrl || key?.meta) return;
    if (key.name === 'enter' || key.name === 'escape' || key.name === 'tab' || key.name === 'backspace' || key.name === 'delete') {
      return;
    }
    const field = state.toolFormFields[state.toolFormIndex];
    if (!field || field.type === 'boolean') return;

    if (field.type === 'number' && !/[\d.\-]/.test(ch)) {
      return;
    }

    const current = field.value === undefined || field.value === null ? '' : String(field.value);
    formFieldUpdate(state, ui, `${current}${ch}`);
  });

  // Any key closes help
  helpPane.on('keypress', () => {
    hideHelp(state, ui);
  });

  // Search input handlers
  searchInput.on('submit', async (value: string) => {
    const query = value.startsWith('/') ? value.slice(1) : value;
    exitSearch(state, ui);
    await applyFilter(state, ui, query, 'hybrid', dbPath, dataDir, state.currentProject, sourceType);
  });

  searchInput.on('cancel', () => {
    exitSearch(state, ui);
  });

  // Regex search input handlers
  regexInput.on('submit', async (value: string) => {
    const query = value.startsWith(':') ? value.slice(1) : value;
    exitSearch(state, ui);
    await applyFilter(state, ui, query, 'regex', dbPath, dataDir, state.currentProject, sourceType);
  });

  regexInput.on('cancel', () => {
    exitSearch(state, ui);
  });

  // Document search input handlers (fullview mode)
  docSearchInput.on('submit', (value: string) => {
    const pattern = value.startsWith('/') ? value.slice(1) : value;
    exitDocSearch(state, ui, false);

    if (!pattern && state.docSearchPattern) {
      // Empty input with existing search = go to next match (like vim)
      nextMatch(state, ui);
    } else {
      applyDocSearch(state, ui, pattern);
    }
  });

  docSearchInput.on('cancel', () => {
    exitDocSearch(state, ui, false);
  });

  // Load data
  try {
    state.sources = await getAllSources(dbPath, {
      project,
      source_type: sourceType,
      limit,
    });
    state.filtered = [...state.sources];
  } catch (error) {
    ui.statusBar.setContent(` Error: ${error}`);
    screen.render();
    return;
  }

  // Initial render
  updateStatus(ui, state, state.currentProject, sourceType);
  renderList(ui, state);
  renderPreview(ui, state);
  listContent.focus();
  screen.render();
}

// Re-export types for convenience
export type { BrowseOptions } from './browse-types.js';
