/**
 * Research handlers for the Lore Document Browser TUI
 *
 * Spawns the full agentic research mode for comprehensive,
 * iterative research with citations.
 *
 * Supports slash commands and maintains research history.
 *
 * Slash commands:
 *   /project <name> or /p <name> - Set project filter
 *   /type <type> or /t <type>    - Set content type filter
 *   /clear                       - Clear all filters
 *   /new                         - Clear research history
 *   /help or /?                  - Show available commands
 */

import type { BrowserState, UIComponents } from './browse-types.js';
import { handleResearch } from '../mcp/handlers/research.js';
import { showProjectPicker } from './browse-handlers-project-picker.js';
import { showContentTypeFilter } from './browse-handlers-filters.js';
import type { ResearchPackage } from '../core/types.js';

const CONTENT_TYPES = ['interview', 'meeting', 'conversation', 'document', 'note', 'analysis'];

/**
 * Build the filter display string
 */
function getFilterDisplay(state: BrowserState): { filters: string[]; filterInfo: string; footerNote: string } {
  const filters: string[] = [];
  if (state.currentProject) filters.push(`project: ${state.currentProject}`);
  if (state.currentContentType) filters.push(`type: ${state.currentContentType}`);

  const filterInfo = filters.length > 0
    ? `{yellow-fg}Scope: ${filters.join(', ')}{/yellow-fg}`
    : '{blue-fg}No filters{/blue-fg}';

  const footerNote = filters.length > 0
    ? `{yellow-fg}${filters.join(', ')}{/yellow-fg}`
    : '{blue-fg}all sources{/blue-fg}';

  return { filters, filterInfo, footerNote };
}

/**
 * Render the research pane with history
 */
function renderResearchPane(state: BrowserState, ui: UIComponents): void {
  const { filterInfo } = getFilterDisplay(state);
  const lines: string[] = [];

  // Show filter status at top
  lines.push(`${filterInfo}  {blue-fg}│{/blue-fg}  {white-fg}/help{/white-fg} for commands  {blue-fg}│{/blue-fg}  {white-fg}/new{/white-fg} to start fresh`);
  lines.push('');

  // Show research history
  if (state.researchHistory.length > 0) {
    for (const item of state.researchHistory) {
      lines.push(`{cyan-fg}Research:{/cyan-fg} ${item.query}`);
      lines.push('');
      // Escape blessed tags in summary
      const escaped = item.summary
        .replace(/\{/g, '\\{')
        .replace(/\}/g, '\\}');
      lines.push(escaped);
      lines.push('');
      lines.push('{blue-fg}───────────────────────────────────────{/blue-fg}');
      lines.push('');
    }
  }

  // Show current research if running
  if (state.researchRunning) {
    lines.push(`{cyan-fg}Research:{/cyan-fg} ${state.researchQuery}`);
    lines.push('');
    lines.push('{yellow-fg}Researching... (agent is exploring sources){/yellow-fg}');
  } else if (state.researchHistory.length === 0) {
    lines.push('{blue-fg}Enter a research task to begin comprehensive analysis...{/blue-fg}');
    lines.push('');
    lines.push('{blue-fg}The research agent will iteratively explore sources,{/blue-fg}');
    lines.push('{blue-fg}cross-reference findings, and synthesize results.{/blue-fg}');
  }

  ui.askPane.setContent(lines.join('\n'));
}

/**
 * Update the footer for research mode
 */
function updateResearchFooter(ui: UIComponents, state: BrowserState, status?: string): void {
  const { footerNote } = getFilterDisplay(state);
  if (status) {
    ui.footer.setContent(` ${status}  │  Scope: ${footerNote}`);
  } else if (state.researchRunning) {
    ui.footer.setContent(` Researching...  │  Scope: ${footerNote}`);
  } else {
    const historyNote = state.researchHistory.length > 0 ? `${state.researchHistory.length} tasks  │  ` : '';
    ui.footer.setContent(` ${historyNote}Enter: Research  │  Esc: Back  │  Scope: ${footerNote}`);
  }
}

/**
 * Enter research mode - show input for research task
 */
export function enterResearchMode(state: BrowserState, ui: UIComponents): void {
  state.mode = 'research';
  state.researchQuery = '';
  state.researchRunning = false;
  // Don't clear history - allow viewing previous research

  // Hide list/preview panes
  ui.listPane.hide();
  ui.previewPane.hide();

  // Reuse ask UI components
  ui.askInput.show();
  ui.askInput.setValue('');
  ui.askPane.show();
  ui.askPane.setLabel(' Research Agent ');

  renderResearchPane(state, ui);
  updateResearchFooter(ui, state);

  ui.askInput.focus();
  ui.askInput.readInput();
  ui.screen.render();
}

/**
 * Exit research mode - return to list
 */
export function exitResearchMode(state: BrowserState, ui: UIComponents): void {
  state.mode = 'list';
  state.researchQuery = '';
  state.researchRunning = false;
  state.researchResponse = '';
  // Keep researchHistory for when they come back
  // Clear research-mode filters so they don't affect list operations
  state.currentProject = undefined;
  state.currentContentType = undefined;

  ui.askInput.hide();
  ui.askInput.setValue('');
  ui.askPane.hide();
  ui.askPane.setLabel(' Response ');

  ui.listPane.show();
  ui.previewPane.show();

  ui.footer.setContent(' j/k Nav │ / Search │ a Ask │ R Research │ p Proj │ c Type │ m Move │ i Edit │ Esc Quit │ ? Help');
  ui.listContent.focus();
  ui.screen.render();
}

/**
 * Show help for slash commands
 */
function showCommandHelp(ui: UIComponents, state: BrowserState): void {
  const helpText = `{bold}Slash Commands:{/bold}

  /p or /project   Show project picker
  /p <name>        Set project filter directly
  /t or /type      Show content type picker
  /t <type>        Set type filter directly
                   (interview, meeting, conversation,
                    document, note, analysis)
  /clear           Clear all filters
  /new             Clear research history
  /help or /?      Show this help

{bold}Current filters:{/bold}
  Project: ${state.currentProject || '(none)'}
  Type: ${state.currentContentType || '(none)'}

{blue-fg}Press Enter to continue...{/blue-fg}`;

  ui.askPane.setContent(helpText);
  ui.screen.render();
}

/**
 * Handle slash commands
 * Returns true if input was a command (handled), false if it's a research task
 */
async function handleSlashCommand(
  input: string,
  state: BrowserState,
  ui: UIComponents,
  dbPath: string
): Promise<boolean> {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) return false;

  const parts = trimmed.slice(1).split(/\s+/);
  const cmd = parts[0].toLowerCase();
  const arg = parts.slice(1).join(' ');

  switch (cmd) {
    case 'help':
    case '?':
      showCommandHelp(ui, state);
      return true;

    case 'new':
      state.researchHistory = [];
      state.researchResponse = '';
      renderResearchPane(state, ui);
      updateResearchFooter(ui, state, 'Research history cleared');
      ui.screen.render();
      return true;

    case 'clear':
      state.currentProject = undefined;
      state.currentContentType = undefined;
      renderResearchPane(state, ui);
      updateResearchFooter(ui, state, 'Filters cleared');
      ui.screen.render();
      return true;

    case 'p':
    case 'project': {
      if (!arg) {
        // Show interactive project picker
        state.pickerReturnMode = 'research';
        ui.askInput.hide();
        ui.askPane.hide();
        showProjectPicker(state, ui, dbPath);
        return true;
      }
      state.currentProject = arg;
      renderResearchPane(state, ui);
      updateResearchFooter(ui, state, `Project set to: ${arg}`);
      ui.screen.render();
      return true;
    }

    case 't':
    case 'type': {
      if (!arg) {
        // Show interactive content type picker
        state.pickerReturnMode = 'research';
        ui.askInput.hide();
        ui.askPane.hide();
        showContentTypeFilter(state, ui);
        return true;
      }
      if (!CONTENT_TYPES.includes(arg)) {
        ui.askPane.setContent(`{red-fg}Unknown type: ${arg}{/red-fg}\n\nAvailable: ${CONTENT_TYPES.join(', ')}`);
        ui.screen.render();
        return true;
      }
      state.currentContentType = arg;
      renderResearchPane(state, ui);
      updateResearchFooter(ui, state, `Type set to: ${arg}`);
      ui.screen.render();
      return true;
    }

    default:
      ui.askPane.setContent(`{red-fg}Unknown command: /${cmd}{/red-fg}\n\nType /help for available commands.`);
      ui.screen.render();
      return true;
  }
}

/**
 * Prompt for next input after research completes
 */
export function promptForFollowUpResearch(state: BrowserState, ui: UIComponents): void {
  ui.askInput.show();
  ui.askInput.setValue('');
  ui.askInput.focus();
  ui.askInput.readInput();
  updateResearchFooter(ui, state);
  ui.screen.render();
}

/**
 * Format research package for display
 */
function formatResearchResult(result: ResearchPackage): string {
  const lines: string[] = [];

  // Summary
  lines.push('{bold}Summary{/bold}');
  lines.push('');
  lines.push(result.summary);
  lines.push('');

  // Key findings
  if (result.key_findings?.length) {
    lines.push('{bold}Key Findings{/bold}');
    for (const finding of result.key_findings) {
      lines.push(`• ${finding}`);
    }
    lines.push('');
  }

  // Conflicts resolved
  if (result.conflicts_resolved?.length) {
    lines.push('{bold}Conflicts Resolved{/bold}');
    for (const conflict of result.conflicts_resolved) {
      lines.push(`• ${conflict}`);
    }
    lines.push('');
  }

  // Supporting quotes (limit to 5 for brevity in history)
  if (result.supporting_quotes?.length) {
    lines.push('{bold}Key Quotes{/bold}');
    for (const quote of result.supporting_quotes.slice(0, 5)) {
      const speaker = quote.speaker_name || quote.speaker || 'Unknown';
      lines.push(`"${quote.text}"`);
      lines.push(`  — ${speaker}${quote.citation?.context ? ` (${quote.citation.context})` : ''}`);
    }
    if (result.supporting_quotes.length > 5) {
      lines.push(`  ... and ${result.supporting_quotes.length - 5} more quotes`);
    }
    lines.push('');
  }

  // Sources consulted
  if (result.sources_consulted?.length) {
    lines.push('{bold}Sources ({/bold}' + result.sources_consulted.length + '{bold}){/bold}');
    for (const source of result.sources_consulted.slice(0, 5)) {
      lines.push(`• ${source.title}`);
    }
    if (result.sources_consulted.length > 5) {
      lines.push(`  ... and ${result.sources_consulted.length - 5} more`);
    }
    lines.push('');
  }

  // Gaps identified
  if (result.gaps_identified?.length) {
    lines.push('{bold}Gaps Identified{/bold}');
    for (const gap of result.gaps_identified) {
      lines.push(`• ${gap}`);
    }
    lines.push('');
  }

  // Suggested queries
  if (result.suggested_queries?.length) {
    lines.push('{bold}Suggested Follow-ups{/bold}');
    for (const query of result.suggested_queries) {
      lines.push(`• ${query}`);
    }
  }

  return lines.join('\n');
}

/**
 * Execute the research task
 */
export async function executeResearch(
  state: BrowserState,
  ui: UIComponents,
  dbPath: string,
  dataDir: string,
  query: string
): Promise<void> {
  const trimmed = query.trim();
  if (!trimmed) {
    renderResearchPane(state, ui);
    promptForFollowUpResearch(state, ui);
    return;
  }

  // Check for slash commands
  if (await handleSlashCommand(trimmed, state, ui, dbPath)) {
    promptForFollowUpResearch(state, ui);
    return;
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    ui.askPane.setContent('{red-fg}Error: ANTHROPIC_API_KEY not set{/red-fg}');
    ui.screen.render();
    return;
  }

  state.researchQuery = trimmed;
  state.researchRunning = true;

  ui.askInput.hide();
  renderResearchPane(state, ui);
  updateResearchFooter(ui, state);
  ui.screen.render();

  try {
    // Run the full research agent
    const result = await handleResearch(dbPath, dataDir, {
      task: trimmed,
      project: state.currentProject || undefined,
      content_type: state.currentContentType || undefined,
      include_sources: true,
    }, { hookContext: { mode: 'cli' } });

    state.researchRunning = false;

    // Format and add to history
    const formatted = formatResearchResult(result);
    state.researchHistory.push({
      query: trimmed,
      summary: formatted,
    });

    renderResearchPane(state, ui);
    promptForFollowUpResearch(state, ui);

  } catch (error) {
    state.researchRunning = false;
    const errorMsg = error instanceof Error ? error.message : String(error);
    state.researchHistory.push({
      query: trimmed,
      summary: `Error: ${errorMsg}`,
    });
    renderResearchPane(state, ui);
    promptForFollowUpResearch(state, ui);
  }
}
