/**
 * Autocomplete handlers for Ask/Research mode slash commands
 *
 * Provides typeahead suggestions as you type:
 * - "/" shows available commands
 * - "/p " or "/project " shows projects
 * - "/t " or "/type " shows content types
 */

import type { BrowserState, UIComponents, ProjectInfo } from './browse-types.js';
import { getAllSources } from '../core/vector-store.js';

// Command definitions
const SLASH_COMMANDS = [
  { value: '/p', label: '/p', description: 'Select project filter' },
  { value: '/project', label: '/project', description: 'Select project filter' },
  { value: '/t', label: '/t', description: 'Select content type filter' },
  { value: '/type', label: '/type', description: 'Select content type filter' },
  { value: '/clear', label: '/clear', description: 'Clear all filters' },
  { value: '/new', label: '/new', description: 'Start fresh conversation' },
  { value: '/help', label: '/help', description: 'Show command help' },
];

// Content types
const CONTENT_TYPES = [
  { value: 'interview', label: 'interview', description: 'User interviews' },
  { value: 'meeting', label: 'meeting', description: 'Meeting notes' },
  { value: 'conversation', label: 'conversation', description: 'AI conversations' },
  { value: 'document', label: 'document', description: 'Documents' },
  { value: 'note', label: 'note', description: 'Notes' },
  { value: 'analysis', label: 'analysis', description: 'Analysis documents' },
];

// Cache for projects
let projectsCache: ProjectInfo[] | null = null;
let projectsCacheTime = 0;
const CACHE_TTL = 60000; // 1 minute

/**
 * Load projects (with caching)
 */
async function loadProjects(dbPath: string): Promise<Array<{ value: string; label: string; description?: string }>> {
  const now = Date.now();
  if (projectsCache && now - projectsCacheTime < CACHE_TTL) {
    return projectsCache.map(p => ({
      value: p.name,
      label: p.name,
      description: `${p.count} docs`,
    }));
  }

  try {
    const sources = await getAllSources(dbPath, { limit: 1000 });
    const projectMap = new Map<string, { count: number; latest: string }>();

    for (const source of sources) {
      for (const project of source.projects) {
        const existing = projectMap.get(project);
        if (!existing) {
          projectMap.set(project, { count: 1, latest: source.created_at });
        } else {
          existing.count++;
          if (source.created_at > existing.latest) {
            existing.latest = source.created_at;
          }
        }
      }
    }

    projectsCache = Array.from(projectMap.entries())
      .map(([name, data]) => ({
        name,
        count: data.count,
        latestActivity: data.latest,
      }))
      .sort((a, b) => b.count - a.count);

    projectsCacheTime = now;

    return projectsCache.map(p => ({
      value: p.name,
      label: p.name,
      description: `${p.count} docs`,
    }));
  } catch {
    return [];
  }
}

/**
 * Update autocomplete based on current input
 */
export async function updateAutocomplete(
  state: BrowserState,
  ui: UIComponents,
  dbPath: string,
  inputValue: string
): Promise<void> {
  const trimmed = inputValue.trim();

  // No autocomplete for empty or non-slash input
  if (!trimmed.startsWith('/')) {
    hideAutocomplete(state, ui);
    return;
  }

  // Check if we're typing a command or have completed one
  const parts = trimmed.split(/\s+/);
  const cmd = parts[0].toLowerCase();
  const hasSpace = trimmed.includes(' ');
  const arg = hasSpace ? parts.slice(1).join(' ') : '';

  // Project selection: /p <arg> or /project <arg>
  if ((cmd === '/p' || cmd === '/project') && hasSpace) {
    const projects = await loadProjects(dbPath);
    const filtered = arg
      ? projects.filter(p => p.label.toLowerCase().includes(arg.toLowerCase()))
      : projects;

    if (filtered.length > 0) {
      state.autocompleteType = 'project';
      state.autocompleteOptions = filtered.slice(0, 8);
      state.autocompleteIndex = 0;
      state.autocompleteVisible = true;
      renderAutocomplete(state, ui);
    } else {
      hideAutocomplete(state, ui);
    }
    return;
  }

  // Type selection: /t <arg> or /type <arg>
  if ((cmd === '/t' || cmd === '/type') && hasSpace) {
    const filtered = arg
      ? CONTENT_TYPES.filter(t => t.label.toLowerCase().includes(arg.toLowerCase()))
      : CONTENT_TYPES;

    if (filtered.length > 0) {
      state.autocompleteType = 'type';
      state.autocompleteOptions = filtered;
      state.autocompleteIndex = 0;
      state.autocompleteVisible = true;
      renderAutocomplete(state, ui);
    } else {
      hideAutocomplete(state, ui);
    }
    return;
  }

  // Command suggestions: starts with / but no space yet
  if (!hasSpace) {
    const filtered = SLASH_COMMANDS.filter(c =>
      c.value.toLowerCase().startsWith(cmd.toLowerCase())
    );

    if (filtered.length > 0 && cmd !== filtered[0].value) {
      // Only show if not exact match
      state.autocompleteType = 'command';
      state.autocompleteOptions = filtered;
      state.autocompleteIndex = 0;
      state.autocompleteVisible = true;
      renderAutocomplete(state, ui);
    } else {
      hideAutocomplete(state, ui);
    }
    return;
  }

  hideAutocomplete(state, ui);
}

/**
 * Render the autocomplete dropdown
 */
export function renderAutocomplete(state: BrowserState, ui: UIComponents): void {
  if (!state.autocompleteVisible || state.autocompleteOptions.length === 0) {
    ui.autocompleteDropdown.hide();
    return;
  }

  const lines: string[] = [];

  for (let i = 0; i < state.autocompleteOptions.length; i++) {
    const opt = state.autocompleteOptions[i];
    const isSelected = i === state.autocompleteIndex;
    const prefix = isSelected ? '{inverse}' : '';
    const suffix = isSelected ? '{/inverse}' : '';
    const desc = opt.description ? ` {blue-fg}${opt.description}{/blue-fg}` : '';

    lines.push(`${prefix} ${opt.label}${desc} ${suffix}`);
  }

  lines.push('');
  lines.push('{blue-fg}Up/Down navigate  Tab select  Esc cancel{/blue-fg}');

  ui.autocompleteDropdown.setContent(lines.join('\n'));

  // Adjust height based on content
  const height = Math.min(state.autocompleteOptions.length + 3, 12);
  ui.autocompleteDropdown.height = height;

  ui.autocompleteDropdown.show();
  ui.screen.render();
}

/**
 * Hide the autocomplete dropdown
 */
export function hideAutocomplete(state: BrowserState, ui: UIComponents): void {
  if (state.autocompleteVisible) {
    state.autocompleteVisible = false;
    state.autocompleteOptions = [];
    state.autocompleteIndex = 0;
    state.autocompleteType = null;
    ui.autocompleteDropdown.hide();
    ui.screen.render();
  }
}

/**
 * Navigate autocomplete down
 */
export function autocompleteDown(state: BrowserState, ui: UIComponents): boolean {
  if (!state.autocompleteVisible) return false;

  if (state.autocompleteIndex < state.autocompleteOptions.length - 1) {
    state.autocompleteIndex++;
    renderAutocomplete(state, ui);
  }
  return true;
}

/**
 * Navigate autocomplete up
 */
export function autocompleteUp(state: BrowserState, ui: UIComponents): boolean {
  if (!state.autocompleteVisible) return false;

  if (state.autocompleteIndex > 0) {
    state.autocompleteIndex--;
    renderAutocomplete(state, ui);
  }
  return true;
}

/**
 * Result from autocomplete selection
 */
export interface AutocompleteResult {
  type: 'input' | 'project' | 'contentType';
  value: string;
}

/**
 * Select current autocomplete option
 * Returns what was selected so caller can handle appropriately
 */
export function autocompleteSelect(state: BrowserState, ui: UIComponents): AutocompleteResult | null {
  if (!state.autocompleteVisible || state.autocompleteOptions.length === 0) {
    return null;
  }

  const selected = state.autocompleteOptions[state.autocompleteIndex];
  hideAutocomplete(state, ui);

  switch (state.autocompleteType) {
    case 'command':
      // For commands like /p, /t, add a space to trigger next autocomplete
      if (selected.value === '/p' || selected.value === '/project' ||
          selected.value === '/t' || selected.value === '/type') {
        return { type: 'input', value: selected.value + ' ' };
      } else {
        return { type: 'input', value: selected.value };
      }

    case 'project':
      // Directly return project name for immediate application
      return { type: 'project', value: selected.value };

    case 'type':
      // Directly return type for immediate application
      return { type: 'contentType', value: selected.value };

    default:
      return null;
  }
}

/**
 * Check if autocomplete handled a key event
 * Returns true if the key was handled (should not propagate)
 */
export function handleAutocompleteKey(
  state: BrowserState,
  ui: UIComponents,
  key: string
): { handled: boolean; result?: AutocompleteResult } {
  if (!state.autocompleteVisible) {
    return { handled: false };
  }

  switch (key) {
    case 'down':
      autocompleteDown(state, ui);
      return { handled: true };

    case 'up':
      autocompleteUp(state, ui);
      return { handled: true };

    case 'tab':
    case 'return': {
      const result = autocompleteSelect(state, ui);
      if (result !== null) {
        return { handled: true, result };
      }
      return { handled: false };
    }

    case 'escape':
      hideAutocomplete(state, ui);
      return { handled: true };

    default:
      return { handled: false };
  }
}
