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
    width: '100%-4',
    height: '100%-6',
    tags: true,
    scrollable: true,
    alwaysScroll: true,
    keys: false,
    mouse: false,
  });

  // Help overlay (hidden initially)
  const helpPane = blessed.box({
    parent: screen,
    top: 'center',
    left: 'center',
    width: 50,
    height: 20,
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
  j/k ↑/↓    Navigate documents
  Enter      View full document
  /          Hybrid search (semantic+keyword)
  :          Regex search (grep files)
  p          Switch project filter
  C-p        Clear project filter (show all)
  t          Tools
  P          Pending proposals
  e          Open in $EDITOR
  s          Sync now (git pull + index)

{bold}Document View:{/bold}
  j/k        Scroll up/down
  /          Search in document (regex)
  n / N      Next/previous match
  Esc        Clear search / back to list
  e          Open in $EDITOR

{bold}Other:{/bold}
  q          Quit
  ?          Show this help

{blue-fg}Press any key to close{/blue-fg}
`,
  });

  // Project picker overlay (hidden initially)
  const projectPicker = blessed.box({
    parent: screen,
    top: 'center',
    left: 'center',
    width: 50,
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

  const toolForm = blessed.box({
    parent: screen,
    top: 'center',
    left: 'center',
    width: '80%',
    height: '60%',
    border: {
      type: 'line',
    },
    label: ' Tool Form ',
    style: {
      fg: 'white',
      bg: 'black',
      border: {
        fg: 'cyan',
      },
    },
    hidden: true,
    tags: true,
  });

  const toolFormContent = blessed.box({
    parent: toolForm,
    top: 0,
    left: 1,
    width: '100%-3',
    height: '100%-2',
    tags: true,
    scrollable: true,
    alwaysScroll: true,
    keys: false,
    mouse: false,
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
    style: { border: { fg: 'cyan' } },
    hidden: true,
    tags: true,
    scrollable: true,
    alwaysScroll: true,
    keys: true,
    vi: true,
    mouse: true,
  });

  // Footer
  const footer = blessed.box({
    parent: screen,
    bottom: 0,
    left: 0,
    width: '100%',
    height: 1,
    content: ' ↑↓ Navigate  │  Enter View  │  / Search  │  a Ask  │  p Projects  │  t Tools  │  r Review  │  q Quit  │  ? Help',
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
    helpPane,
    searchInput,
    regexInput,
    docSearchInput,
    toolForm,
    toolFormContent,
    askInput,
    askPane,
    footer,
    projectPicker,
    projectPickerContent,
  };
}
