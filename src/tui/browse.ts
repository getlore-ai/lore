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
import { updateStatus, renderList, renderPreview, buildListItems } from './browse-render.js';
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
  toggleProjectExpand,
  renderReturnToAskOrResearch,
  expandCurrentProject,
  collapseCurrentProject,
  toggleGroupedView,
  isDocumentSelected,
  // Move picker
  showMovePicker,
  movePickerDown,
  movePickerUp,
  confirmMove,
  cancelMovePicker,
  // Edit info
  enterEditInfo,
  saveEditInfo,
  exitEditInfo,
  // Type picker
  showTypePicker,
  typePickerDown,
  typePickerUp,
  confirmTypeChange,
  cancelTypePicker,
  // Content type filter
  showContentTypeFilter,
  contentTypeFilterDown,
  contentTypeFilterUp,
  applyContentTypeFilter,
  cancelContentTypeFilter,
  clearContentTypeFilter,
  // Log visibility
  toggleLogs,
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
  promptForFollowUp,
} from './browse-handlers-ask.js';
import {
  enterResearchMode,
  exitResearchMode,
  executeResearch,
  promptForFollowUpResearch,
} from './browse-handlers-research.js';
import {
  updateAutocomplete,
  hideAutocomplete,
  handleAutocompleteKey,
} from './browse-handlers-autocomplete.js';
import { getAllSources } from '../core/vector-store.js';

/**
 * Start the document browser TUI
 */
export async function startBrowser(options: BrowseOptions): Promise<void> {
  const { project, sourceType, limit, dataDir } = options;
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
    askHistory: [],
    researchQuery: '',
    researchRunning: false,
    researchResponse: '',
    researchHistory: [],
    // Grouped view (enabled by default)
    groupByProject: true,
    expandedProjects: new Set<string>(),
    listItems: [],
    // Move picker state
    movePickerIndex: 0,
    movePickerProjects: [],
    moveTargetSource: undefined,
    // Edit info state
    editSource: undefined,
    editTitle: '',
    editProjects: [],
    editFieldIndex: 0,
    // Type picker state
    typePickerIndex: 0,
    typePickerSource: undefined,
    // Content type filter state
    contentTypeFilterIndex: 0,
    currentContentType: undefined,
    // Log visibility toggle
    showLogs: false,
    // Return mode after picker
    pickerReturnMode: undefined,
    // Load limit for getAllSources queries
    loadLimit: limit,
    // Autocomplete state
    autocompleteVisible: false,
    autocompleteOptions: [],
    autocompleteIndex: 0,
    autocompleteType: null,
    autocompleteJustSelected: false,
  };

  // Create UI components
  const ui = createUIComponents();
  const { screen, helpPane, searchInput, regexInput, docSearchInput, listContent } = ui;

  // Key bindings

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
    } else if (state.mode === 'move-picker') {
      cancelMovePicker(state, ui);
    } else if (state.mode === 'type-picker') {
      cancelTypePicker(state, ui);
    } else if (state.mode === 'content-type-filter') {
      cancelContentTypeFilter(state, ui);
    } else if (state.mode === 'edit-info') {
      exitEditInfo(state, ui);
    } else if (state.mode === 'delete-confirm') {
      cancelDelete(state, ui);
    } else if (state.mode === 'extensions') {
      state.mode = 'list';
      ui.listTitle.setContent(state.showLogs ? ' Logs' : ' Documents');
      ui.previewTitle.setContent(' Preview');
      ui.footer.setContent(' j/k Nav │ / Search │ a Ask │ R Research │ p Proj │ c Type │ L Logs │ m Move │ i Edit │ Esc Quit │ ? Help');
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
    } else if (state.mode === 'list') {
      // Quit from main list
      screen.destroy();
      process.exit(0);
    }
  });

  screen.key(['j', 'down'], () => {
    if (state.mode === 'project-picker') {
      projectPickerDown(state, ui);
    } else if (state.mode === 'move-picker') {
      movePickerDown(state, ui);
    } else if (state.mode === 'type-picker') {
      typePickerDown(state, ui);
    } else if (state.mode === 'content-type-filter') {
      contentTypeFilterDown(state, ui);
    } else if (state.mode === 'extensions') {
      if (state.selectedExtensionIndex < state.extensionsList.length - 1) {
        state.selectedExtensionIndex++;
        selectExtension(state, ui);
      }
    } else if (state.mode !== 'search' && state.mode !== 'help' && state.mode !== 'edit-info') {
      state.gPressed = false;
      moveDown(state, ui);
    }
  });

  screen.key(['k', 'up'], () => {
    if (state.mode === 'project-picker') {
      projectPickerUp(state, ui);
    } else if (state.mode === 'move-picker') {
      movePickerUp(state, ui);
    } else if (state.mode === 'type-picker') {
      typePickerUp(state, ui);
    } else if (state.mode === 'content-type-filter') {
      contentTypeFilterUp(state, ui);
    } else if (state.mode === 'extensions') {
      if (state.selectedExtensionIndex > 0) {
        state.selectedExtensionIndex--;
        selectExtension(state, ui);
      }
    } else if (state.mode !== 'search' && state.mode !== 'help' && state.mode !== 'edit-info') {
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
      // In grouped view, Enter on header toggles expand/collapse
      if (state.groupByProject && state.listItems.length > 0) {
        const item = state.listItems[state.selectedIndex];
        if (item?.type === 'header') {
          toggleProjectExpand(state, ui);
          return;
        }
      }
      // Enter on document opens full view
      if (isDocumentSelected(state)) {
        await enterFullView(state, ui, dbPath, sourcesDir);
      }
    } else if (state.mode === 'project-picker') {
      await selectProject(state, ui, dbPath, dataDir, sourceType);
    } else if (state.mode === 'move-picker') {
      await confirmMove(state, ui, dbPath, dataDir, sourceType);
    } else if (state.mode === 'type-picker') {
      await confirmTypeChange(state, ui, dbPath, sourceType);
    } else if (state.mode === 'content-type-filter') {
      await applyContentTypeFilter(state, ui, dbPath, dataDir, sourceType);
    } else if (state.mode === 'edit-info') {
      await saveEditInfo(state, ui, dbPath, sourceType);
    } else if (state.mode === 'extensions') {
      await toggleExtension(state, ui);
    }
  });

  // Space toggles expand/collapse on project headers
  screen.key(['space'], () => {
    if (state.mode === 'list' && state.groupByProject) {
      toggleProjectExpand(state, ui);
    }
  });

  // h collapses current project (vim-style: left = collapse)
  screen.key(['h', 'left'], () => {
    if (state.mode === 'list' && state.groupByProject) {
      collapseCurrentProject(state, ui);
    }
  });

  // l expands current project (vim-style: right = expand)
  screen.key(['l', 'right'], () => {
    if (state.mode === 'list' && state.groupByProject) {
      expandCurrentProject(state, ui);
    }
  });

  // Tab toggles between grouped and flat view
  screen.key(['tab'], () => {
    if (state.mode === 'list') {
      toggleGroupedView(state, ui);
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
      openInEditor(state, ui, sourcesDir, dbPath, dataDir);
    }
  });

  // Move document to different project
  screen.key(['m'], () => {
    if (state.mode === 'list') {
      // Only allow move on documents, not headers
      if (isDocumentSelected(state)) {
        showMovePicker(state, ui, dbPath);
      }
    }
  });

  // Edit document info
  screen.key(['i'], () => {
    if (state.mode === 'list') {
      // Only allow edit on documents, not headers
      if (isDocumentSelected(state)) {
        enterEditInfo(state, ui);
      }
    }
  });

  // Change content type
  screen.key(['t'], () => {
    if (state.mode === 'list') {
      // Only allow type change on documents, not headers
      if (isDocumentSelected(state)) {
        showTypePicker(state, ui);
      }
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

  // Content type filter
  screen.key(['c'], () => {
    if (state.mode === 'list') {
      showContentTypeFilter(state, ui);
    } else if (state.mode === 'content-type-filter') {
      // Toggle behavior
      cancelContentTypeFilter(state, ui);
    }
  });

  screen.key(['C-c'], () => {
    if (state.mode === 'list') {
      clearContentTypeFilter(state, ui, dbPath, dataDir, sourceType);
    }
  });

  // Toggle log visibility
  screen.key(['S-l'], () => {
    if (state.mode === 'list') {
      toggleLogs(state, ui, dbPath, dataDir, sourceType);
    }
  });

  screen.key(['a'], () => {
    if (state.mode === 'list') {
      enterAskMode(state, ui);
    } else if (state.mode === 'ask' && !state.askStreaming) {
      // In ask mode, 'a' refocuses input for follow-up (use /new to clear)
      promptForFollowUp(state, ui);
    }
  });

  screen.key(['S-r'], () => {
    if (state.mode === 'list') {
      enterResearchMode(state, ui);
    } else if (state.mode === 'research' && !state.researchRunning) {
      // In research mode, 'R' refocuses input for follow-up (use /new to clear)
      promptForFollowUpResearch(state, ui);
    }
  });

  screen.key(['x'], () => {
    if (state.mode === 'list') {
      showExtensions(state, ui);
    }
  });

  // Delete keybindings (Delete key or backspace)
  screen.key(['delete', 'backspace'], () => {
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
    // Skip submit if autocomplete just handled the Enter key
    if (state.autocompleteJustSelected) {
      state.autocompleteJustSelected = false;
      // Re-focus and continue input
      askInput.focus();
      askInput.readInput();
      return;
    }

    if (state.mode === 'research') {
      await executeResearch(state, ui, dbPath, dataDir, value);
    } else if (state.mode === 'edit-info') {
      // Save the edited title
      state.editTitle = value;
      await saveEditInfo(state, ui, dbPath, sourceType);
    } else {
      await executeAsk(state, ui, dbPath, value);
    }
  });

  askInput.on('cancel', () => {
    hideAutocomplete(state, ui);
    if (state.mode === 'research') {
      exitResearchMode(state, ui);
    } else if (state.mode === 'edit-info') {
      exitEditInfo(state, ui);
    } else {
      exitAskMode(state, ui);
    }
  });

  // Autocomplete keypress handler for askInput
  askInput.on('keypress', async (_ch: string, key: { name: string; full: string }) => {
    // Only active in ask or research modes (not edit-info)
    if (state.mode !== 'ask' && state.mode !== 'research') {
      return;
    }

    // Check if autocomplete handles this key
    const acResult = handleAutocompleteKey(state, ui, key.name);
    if (acResult.handled) {
      if (acResult.result) {
        // Set flag to prevent submit handler from firing
        state.autocompleteJustSelected = true;

        if (acResult.result.type === 'input') {
          // Just a command prefix, set in textbox
          askInput.setValue(acResult.result.value);
          ui.screen.render();
          // Trigger autocomplete update after setting new value
          await updateAutocomplete(state, ui, dbPath, acResult.result.value);
        } else if (acResult.result.type === 'project') {
          // Directly set project filter - bypass textbox to avoid truncation
          state.currentProject = acResult.result.value;
          askInput.setValue('');
          renderReturnToAskOrResearch(state, ui, state.mode as 'ask' | 'research');
          ui.screen.render();
        } else if (acResult.result.type === 'contentType') {
          // Directly set content type filter - bypass textbox to avoid truncation
          state.currentContentType = acResult.result.value;
          askInput.setValue('');
          renderReturnToAskOrResearch(state, ui, state.mode as 'ask' | 'research');
          ui.screen.render();
        }
      }
      return;
    }

    // After any other key, update autocomplete based on current value
    // Use setImmediate to get the updated value after the keypress is processed
    setImmediate(async () => {
      const currentValue = askInput.getValue();
      await updateAutocomplete(state, ui, dbPath, currentValue);
    });
  });

  // Load data
  try {
    state.sources = await getAllSources(dbPath, {
      project,
      source_type: sourceType,
      exclude_source_type: state.showLogs ? undefined : 'log',
      limit,
    });
    state.filtered = [...state.sources];
    // Build grouped list items
    if (state.groupByProject) {
      state.listItems = buildListItems(state);
    }
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
