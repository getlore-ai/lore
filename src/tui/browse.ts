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
  showDeleteConfirm,
  cancelDelete,
  confirmDelete,
  copyCurrentContent,
} from './browse-handlers.js';
import {
  showExtensions,
  selectExtension,
  toggleExtension,
} from './browse-handlers-extensions.js';
import {
  enterAskMode,
  exitAskMode,
  executeAsk,
} from './browse-handlers-ask.js';
import {
  enterResearchMode,
  exitResearchMode,
  executeResearch,
} from './browse-handlers-research.js';
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
    extensionsList: [],
    selectedExtensionIndex: 0,
    askQuery: '',
    askResponse: '',
    askStreaming: false,
    researchQuery: '',
    researchRunning: false,
    researchResponse: '',
  };

  // Create UI components
  const ui = createUIComponents();
  const { screen, helpPane, searchInput, regexInput, docSearchInput, listContent } = ui;

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
    } else if (state.mode === 'delete-confirm') {
      cancelDelete(state, ui);
    } else if (state.mode === 'extensions') {
      state.mode = 'list';
      ui.listTitle.setContent(' Documents');
      ui.previewTitle.setContent(' Preview');
      ui.footer.setContent(' ↑↓ Navigate │ Enter View │ / Search │ a Ask │ R Research │ p Projects │ d Delete │ q Quit │ ? Help');
      updateStatus(ui, state, state.currentProject, sourceType);
      renderList(ui, state);
      renderPreview(ui, state);
      screen.render();
    } else if (state.mode === 'ask') {
      if (!state.askStreaming) {
        exitAskMode(state, ui);
      }
    } else if (state.mode === 'research') {
      if (!state.researchRunning) {
        exitResearchMode(state, ui);
      }
    } else if (state.mode === 'list' && state.searchQuery) {
      // Clear search filter
      applyFilter(state, ui, '', 'hybrid', dbPath, dataDir, state.currentProject, sourceType);
      screen.render();
    }
  });

  screen.key(['j', 'down'], () => {
    if (state.mode === 'project-picker') {
      projectPickerDown(state, ui);
    } else if (state.mode === 'extensions') {
      if (state.selectedExtensionIndex < state.extensionsList.length - 1) {
        state.selectedExtensionIndex++;
        selectExtension(state, ui);
      }
    } else if (state.mode !== 'search' && state.mode !== 'help') {
      state.gPressed = false;
      moveDown(state, ui);
    }
  });

  screen.key(['k', 'up'], () => {
    if (state.mode === 'project-picker') {
      projectPickerUp(state, ui);
    } else if (state.mode === 'extensions') {
      if (state.selectedExtensionIndex > 0) {
        state.selectedExtensionIndex--;
        selectExtension(state, ui);
      }
    } else if (state.mode !== 'search' && state.mode !== 'help') {
      state.gPressed = false;
      moveUp(state, ui);
    }
  });

  screen.key(['C-d'], () => {
    if (state.mode !== 'search' && state.mode !== 'help' && state.mode !== 'extensions') {
      state.gPressed = false;
      pageDown(state, ui);
    }
  });

  screen.key(['C-u', 'pageup'], () => {
    if (state.mode !== 'search' && state.mode !== 'help' && state.mode !== 'extensions') {
      state.gPressed = false;
      pageUp(state, ui);
    }
  });

  screen.key(['pagedown'], () => {
    if (state.mode !== 'search' && state.mode !== 'help' && state.mode !== 'extensions') {
      state.gPressed = false;
      pageDown(state, ui);
    }
  });

  screen.key(['home'], () => {
    if (state.mode !== 'search' && state.mode !== 'help' && state.mode !== 'extensions') {
      state.gPressed = false;
      jumpToStart(state, ui);
    }
  });

  screen.key(['end', 'S-g'], () => {
    if (state.mode !== 'search' && state.mode !== 'help' && state.mode !== 'extensions') {
      state.gPressed = false;
      jumpToEnd(state, ui);
    }
  });

  screen.key(['g'], () => {
    if (state.mode !== 'search' && state.mode !== 'help' && state.mode !== 'extensions') {
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
    if (state.mode === 'list') {
      await enterFullView(state, ui, dbPath, sourcesDir);
    } else if (state.mode === 'project-picker') {
      await selectProject(state, ui, dbPath, dataDir, sourceType);
    } else if (state.mode === 'extensions') {
      await toggleExtension(state, ui);
    }
  });

  screen.key(['/'], () => {
    if (state.mode === 'list') {
      enterSearch(state, ui);
    } else if (state.mode === 'fullview') {
      enterDocSearch(state, ui);
    }
  });

  screen.key([':'], () => {
    if (state.mode === 'list') {
      enterRegexSearch(state, ui);
    }
  });

  screen.key(['n'], () => {
    if (state.mode === 'fullview' && state.docSearchMatches.length > 0) {
      nextMatch(state, ui);
    }
  });

  screen.key(['S-n'], () => {
    if (state.mode === 'fullview' && state.docSearchMatches.length > 0) {
      prevMatch(state, ui);
    }
  });

  screen.key(['e'], () => {
    if (state.mode === 'list' || state.mode === 'fullview') {
      openInEditor(state, ui, sourcesDir);
    }
  });

  // Copy to clipboard (y for yank)
  screen.key(['y'], () => {
    if (state.mode === 'fullview' || state.mode === 'ask' || state.mode === 'research') {
      copyCurrentContent(state, ui);
    }
  });

  screen.key(['s'], () => {
    if (state.mode === 'list') {
      triggerSync(state, ui, dbPath, dataDir, state.currentProject, sourceType);
    }
  });

  // Project picker keybindings
  screen.key(['p'], () => {
    if (state.mode === 'list') {
      showProjectPicker(state, ui, dbPath);
    } else if (state.mode === 'project-picker') {
      // In picker, 'p' also closes (toggle behavior)
      cancelProjectPicker(state, ui);
    }
  });

  screen.key(['C-p'], () => {
    if (state.mode === 'list') {
      clearProjectFilter(state, ui, dbPath, dataDir, sourceType);
    }
  });

  screen.key(['a'], () => {
    if (state.mode === 'list') {
      enterAskMode(state, ui);
    } else if (state.mode === 'ask' && !state.askStreaming) {
      // In ask mode, 'a' starts a new question
      ui.askInput.setValue('');
      ui.askInput.show();
      ui.askPane.setContent('{cyan-fg}Enter your question and press Enter{/cyan-fg}');
      ui.askInput.focus();
      ui.askInput.readInput();
      screen.render();
    }
  });

  screen.key(['S-r'], () => {
    if (state.mode === 'list') {
      enterResearchMode(state, ui);
    } else if (state.mode === 'research' && !state.researchRunning) {
      // In research mode, 'R' starts new research
      ui.askInput.setValue('');
      ui.askInput.show();
      ui.askPane.setLabel(' Research Agent ');
      ui.askPane.setContent('{cyan-fg}Enter research task and press Enter{/cyan-fg}\n\n{gray-fg}The research agent will iteratively explore sources,\ncross-reference findings, and synthesize results.{/gray-fg}');
      ui.askInput.focus();
      ui.askInput.readInput();
      screen.render();
    }
  });

  screen.key(['x'], () => {
    if (state.mode === 'list') {
      showExtensions(state, ui);
    }
  });

  // Delete keybindings
  screen.key(['d'], () => {
    if (state.mode === 'list') {
      showDeleteConfirm(state, ui);
    }
  });

  screen.key(['y'], async () => {
    if (state.mode === 'delete-confirm') {
      await confirmDelete(state, ui, dbPath, dataDir, state.currentProject, sourceType);
    }
  });

  screen.key(['n'], () => {
    if (state.mode === 'delete-confirm') {
      cancelDelete(state, ui);
    }
  });

  // Mouse wheel scrolling (ask/research use blessed's native scrolling via askPane)
  screen.on('wheeldown', () => {
    if (state.mode === 'list') {
      moveDown(state, ui);
    } else if (state.mode === 'fullview') {
      moveDown(state, ui);
      moveDown(state, ui);
      moveDown(state, ui);
    } else if (state.mode === 'ask' || state.mode === 'research') {
      ui.askPane.scroll(3);
      ui.screen.render();
    }
  });

  screen.on('wheelup', () => {
    if (state.mode === 'list') {
      moveUp(state, ui);
    } else if (state.mode === 'fullview') {
      moveUp(state, ui);
      moveUp(state, ui);
      moveUp(state, ui);
    } else if (state.mode === 'ask' || state.mode === 'research') {
      ui.askPane.scroll(-3);
      ui.screen.render();
    }
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

  // Ask/Research input handlers (shared input component)
  const { askInput } = ui;
  askInput.on('submit', async (value: string) => {
    if (state.mode === 'research') {
      await executeResearch(state, ui, dbPath, dataDir, value);
    } else {
      await executeAsk(state, ui, dbPath, value);
    }
  });

  askInput.on('cancel', () => {
    if (state.mode === 'research') {
      exitResearchMode(state, ui);
    } else {
      exitAskMode(state, ui);
    }
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
