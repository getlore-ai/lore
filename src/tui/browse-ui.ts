/**
 * UI Components for the Lore Document Browser TUI
 *
 * Creates all blessed UI components and returns them in a structured object.
 */

import blessed from 'blessed';
import type { UIComponents } from './browse-types.js';

/**
 * Create all UI components for the browser
 */
export function createUIComponents(): UIComponents {
  // Create screen
  const screen = blessed.screen({
    smartCSR: true,
    title: 'Lore Browser',
    fullUnicode: true,
    mouse: true,
  });

  // Header
  const header = blessed.box({
    parent: screen,
    top: 0,
    left: 0,
    width: '100%',
    height: 1,
    content: ' Lore Browser',
    style: {
      fg: 'black',
      bg: 'cyan',
      bold: true,
    },
  });

  // Status bar (under header)
  const statusBar = blessed.box({
    parent: screen,
    top: 1,
    left: 0,
    width: '100%',
    height: 1,
    content: ' Loading...',
    tags: true,
    style: {
      fg: 'black',
      bg: 'white',
    },
  });

  // Left pane - document list (55%)
  const listPane = blessed.box({
    parent: screen,
    top: 2,
    left: 0,
    width: '55%',
    height: '100%-4',
    border: {
      type: 'line',
    },
    style: {
      border: {
        fg: 'blue',
      },
    },
    scrollable: true,
    alwaysScroll: true,
    scrollbar: {
      ch: '│',
      style: {
        fg: 'blue',
      },
    },
  });

  const listTitle = blessed.box({
    parent: listPane,
    top: 0,
    left: 1,
    width: '100%-4',
    height: 1,
    content: ' Documents',
    tags: true,
    style: {
      fg: 'white',
      bold: true,
    },
  });

  const listContent = blessed.box({
    parent: listPane,
    top: 2,
    left: 1,
    width: '100%-4',
    height: '100%-4',
    tags: true,
    scrollable: true,
    alwaysScroll: true,
    keys: false,
    mouse: false,
  });

  // Right pane - preview (45%)
  const previewPane = blessed.box({
    parent: screen,
    top: 2,
    left: '55%',
    width: '45%',
    height: '100%-4',
    border: {
      type: 'line',
    },
    style: {
      border: {
        fg: 'blue',
      },
    },
  });

  const previewTitle = blessed.box({
    parent: previewPane,
    top: 0,
    left: 1,
    width: '100%-4',
    height: 1,
    content: ' Preview',
    tags: true,
    style: {
      fg: 'white',
      bold: true,
    },
  });

  const previewContent = blessed.box({
    parent: previewPane,
    top: 2,
    left: 1,
    width: '100%-4',
    height: '100%-4',
    tags: true,
    scrollable: true,
    alwaysScroll: true,
    scrollbar: {
      ch: '│',
      style: {
        bg: 'blue',
      },
    },
  });

  // Full view overlay (hidden initially)
  const fullViewPane = blessed.box({
    parent: screen,
    top: 2,
    left: 0,
    width: '100%',
    height: '100%-4',
    border: {
      type: 'line',
    },
    style: {
      border: {
        fg: 'blue',
      },
    },
    hidden: true,
    scrollable: true,
    alwaysScroll: true,
    scrollbar: {
      ch: '│',
      style: {
        fg: 'blue',
      },
    },
  });

  const fullViewTitle = blessed.box({
    parent: fullViewPane,
    top: 0,
    left: 1,
    width: '100%-4',
    height: 3,
    tags: true,
    style: {
      fg: 'white',
    },
  });

  const fullViewContent = blessed.box({
    parent: fullViewPane,
    top: 4,
    left: 1,
    width: '100%-6',  // Leave room for scrollbar
    height: '100%-6',
    tags: true,
    scrollable: true,
    alwaysScroll: true,
    keys: false,
    mouse: false,
  });

  // Scrollbar track for full view (separate element on right edge)
  const fullViewScrollbar = blessed.box({
    parent: fullViewPane,
    top: 4,
    right: 2,
    width: 1,
    height: '100%-6',
    tags: true,
    style: {
      fg: 'blue',
    },
  });

  // Help overlay (hidden initially)
  const helpPane = blessed.box({
    parent: screen,
    top: 'center',
    left: 'center',
    width: 50,
    height: 29,
    border: {
      type: 'line',
    },
    style: {
      border: {
        fg: 'cyan',
      },
      bg: 'black',
    },
    hidden: true,
    tags: true,
    content: `
{bold}{cyan-fg}Lore Browser Help{/cyan-fg}{/bold}

{bold}List View:{/bold}
  j/k ↑/↓    Navigate
  Space/Enter  Expand/collapse folder
  h/l ←/→    Collapse/expand folder
  Tab        Toggle flat/grouped view
  /          Hybrid search (semantic+keyword)
  :          Regex search (grep files)
  a          Ask a question (AI-powered)
  R          Research mode (agentic)
  p          Project picker
  C-p        Show all projects
  c          Content type filter
  C-c        Clear type filter
  s          Sync now (git pull + index)
  m          Move doc to different project
  i          Edit document title
  t          Change content type
  Del        Delete document or project

{bold}Document View:{/bold}
  j/k        Scroll up/down
  /          Search in document (regex)
  n / N      Next/previous match
  y          Copy to clipboard
  Esc        Back to list
  e          Open in $EDITOR

{bold}Other:{/bold}
  Esc        Back / Quit (from list)
  ?          Show this help

{blue-fg}Press any key to close{/blue-fg}
`,
  });

  // Delete confirmation dialog (hidden initially)
  const deleteConfirm = blessed.box({
    parent: screen,
    top: 'center',
    left: 'center',
    width: 60,
    height: 11,
    border: {
      type: 'line',
    },
    style: {
      border: {
        fg: 'red',
      },
      bg: 'black',
    },
    hidden: true,
    tags: true,
  });

  // Project picker overlay (hidden initially)
  const projectPicker = blessed.box({
    parent: screen,
    top: 'center',
    left: 'center',
    width: '70%',  // Use percentage to accommodate long project names
    height: 15,
    border: {
      type: 'line',
    },
    style: {
      border: {
        fg: 'yellow',
      },
      bg: 'black',
    },
    hidden: true,
    tags: true,
  });

  const projectPickerContent = blessed.box({
    parent: projectPicker,
    top: 0,
    left: 1,
    width: '100%-4',
    height: '100%-2',
    tags: true,
    scrollable: true,
    alwaysScroll: true,
  });

  // Search input (hidden initially)
  const searchInput = blessed.textbox({
    parent: screen,
    top: 1,
    left: 0,
    width: '100%',
    height: 1,
    style: {
      fg: 'white',
      bg: 'magenta',
    },
    hidden: true,
    inputOnFocus: true,
  });

  // Regex search input (hidden initially)
  const regexInput = blessed.textbox({
    parent: screen,
    top: 1,
    left: 0,
    width: '100%',
    height: 1,
    style: {
      fg: 'white',
      bg: 'cyan',
    },
    hidden: true,
    inputOnFocus: true,
  });

  // Document search input (for fullview mode)
  const docSearchInput = blessed.textbox({
    parent: screen,
    top: 1,
    left: 0,
    width: '100%',
    height: 1,
    style: {
      fg: 'white',
      bg: 'green',
    },
    hidden: true,
    inputOnFocus: true,
  });

  // Ask input (hidden initially)
  const askInput = blessed.textbox({
    parent: screen,
    top: 2,
    left: 0,
    width: '100%',
    height: 3,
    label: ' Ask Lore ',
    border: { type: 'line' },
    style: { border: { fg: 'cyan' }, focus: { border: { fg: 'green' } } },
    hidden: true,
    inputOnFocus: true,
  });

  // Ask response pane (hidden initially)
  const askPane = blessed.box({
    parent: screen,
    top: 5,
    left: 0,
    width: '100%',
    height: '100%-7',
    label: ' Response ',
    border: { type: 'line' },
    style: { fg: 'white', border: { fg: 'cyan' } },
    hidden: true,
    tags: true,
    scrollable: true,
    alwaysScroll: true,
    keys: true,
    vi: true,
    mouse: true,
  });

  // Autocomplete dropdown (hidden initially)
  const autocompleteDropdown = blessed.box({
    parent: screen,
    top: 5,
    left: 1,
    width: '60%',  // Use percentage to accommodate long project names
    height: 10,
    border: { type: 'line' },
    style: {
      fg: 'white',
      bg: 'black',
      border: { fg: 'yellow' },
    },
    hidden: true,
    tags: true,
  });

  // Footer
  const footer = blessed.box({
    parent: screen,
    bottom: 0,
    left: 0,
    width: '100%',
    height: 1,
    content: ' j/k Nav │ / Search │ a Ask │ R Research │ p Proj │ c Type │ m Move │ i Edit │ Esc Quit │ ? Help',
    tags: true,
    style: {
      fg: 'white',
      bg: 'black',
    },
  });

  return {
    screen,
    header,
    statusBar,
    listPane,
    listTitle,
    listContent,
    previewPane,
    previewTitle,
    previewContent,
    fullViewPane,
    fullViewTitle,
    fullViewContent,
    fullViewScrollbar,
    helpPane,
    searchInput,
    regexInput,
    docSearchInput,
    askInput,
    askPane,
    autocompleteDropdown,
    footer,
    projectPicker,
    projectPickerContent,
    deleteConfirm,
  };
}
