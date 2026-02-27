/**
 * Ask handlers for the Lore Document Browser TUI
 *
 * Handles AI-powered queries with streaming responses.
 * Supports slash commands and multi-turn conversations.
 *
 * Slash commands:
 *   /project <name> or /p <name> - Set project filter
 *   /type <type> or /t <type>    - Set content type filter
 *   /clear                       - Clear all filters
 *   /new                         - Start new conversation
 *   /help or /?                  - Show available commands
 */

import Anthropic from '@anthropic-ai/sdk';
import type { BrowserState, UIComponents } from './browse-types.js';
import { searchSources, getAllSources } from '../core/vector-store.js';
import { generateEmbedding } from '../core/embedder.js';
import { showProjectPicker } from './browse-handlers-project-picker.js';
import { showContentTypeFilter } from './browse-handlers-filters.js';
import { detectTemporalIntent, sortByRecency, formatDate } from '../core/temporal.js';

const SYSTEM_PROMPT = `You are a research assistant with access to a knowledge base.
Your job is to answer questions based on the provided sources.

When answering:
- Cite specific sources when making claims
- Be concise but thorough
- If the sources don't contain enough information, say so
- Consider previous conversation context when answering follow-up questions
- Each source has a Date — use it to answer recency questions (e.g. "most recent", "latest")

Source format: Each source has an ID, title, date, and content summary.`;

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
 * Render the conversation history and prompt
 */
function renderAskPane(state: BrowserState, ui: UIComponents, showInput = true): void {
  const { filterInfo } = getFilterDisplay(state);
  const lines: string[] = [];

  // Show filter status at top (using brighter colors for dark terminals)
  lines.push(`${filterInfo}  {blue-fg}│{/blue-fg}  {white-fg}/help{/white-fg} for commands  {blue-fg}│{/blue-fg}  {white-fg}/new{/white-fg} to start fresh`);
  lines.push('');

  // Show conversation history
  if (state.askHistory.length > 0) {
    for (const msg of state.askHistory) {
      if (msg.role === 'user') {
        lines.push(`{cyan-fg}You:{/cyan-fg} ${msg.content}`);
      } else {
        // Escape blessed tags in assistant response
        const escaped = msg.content
          .replace(/\{/g, '\\{')
          .replace(/\}/g, '\\}');
        lines.push(`{green-fg}Assistant:{/green-fg}`);
        lines.push(escaped);
      }
      lines.push('');
    }
  }

  // Show current streaming response if any
  if (state.askStreaming && state.askResponse) {
    lines.push(`{cyan-fg}You:{/cyan-fg} ${state.askQuery}`);
    lines.push(`{green-fg}Assistant:{/green-fg}`);
    const escaped = state.askResponse
      .replace(/\{/g, '\\{')
      .replace(/\}/g, '\\}');
    lines.push(escaped);
  } else if (showInput && state.askHistory.length === 0) {
    lines.push('{blue-fg}Ask a question about your knowledge base...{/blue-fg}');
  }

  ui.askPane.setContent(lines.join('\n'));
}

/**
 * Update the footer for ask mode
 */
function updateAskFooter(ui: UIComponents, state: BrowserState, status?: string): void {
  const { footerNote } = getFilterDisplay(state);
  if (status) {
    ui.footer.setContent(` ${status}  │  Scope: ${footerNote}`);
  } else if (state.askStreaming) {
    ui.footer.setContent(` Generating...  │  Scope: ${footerNote}`);
  } else {
    const historyNote = state.askHistory.length > 0 ? `${state.askHistory.length / 2} Q&A  │  ` : '';
    ui.footer.setContent(` ${historyNote}Enter: Send  │  Esc: Back  │  Scope: ${footerNote}`);
  }
}

/**
 * Enter ask mode - show input for query
 */
export function enterAskMode(state: BrowserState, ui: UIComponents): void {
  state.mode = 'ask';
  state.askQuery = '';
  state.askResponse = '';
  state.askStreaming = false;
  // Don't clear history - allow continuing conversation

  // Hide list/preview panes
  ui.listPane.hide();
  ui.previewPane.hide();

  // Show ask UI
  ui.askInput.show();
  ui.askInput.setValue('');
  ui.askPane.show();
  ui.askPane.setLabel(' Ask Lore ');

  renderAskPane(state, ui);
  updateAskFooter(ui, state);

  ui.askInput.focus();
  ui.askInput.readInput();
  ui.screen.render();
}

/**
 * Exit ask mode - return to list
 */
export function exitAskMode(state: BrowserState, ui: UIComponents): void {
  state.mode = 'list';
  state.askQuery = '';
  state.askResponse = '';
  state.askStreaming = false;
  // Keep askHistory for when they come back
  // Clear ask-mode filters so they don't affect list operations
  state.currentProject = undefined;
  state.currentContentType = undefined;

  ui.askInput.hide();
  ui.askInput.setValue('');
  ui.askPane.hide();

  ui.listPane.show();
  ui.previewPane.show();

  ui.footer.setContent(' j/k Nav │ / Search │ a Ask │ R Research │ p Proj │ c Type │ m Move │ i Edit │ q Quit │ ? Help');
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
  /new             Start new conversation (clear history)
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
 * Returns true if input was a command (handled), false if it's a question
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
      state.askHistory = [];
      state.askResponse = '';
      renderAskPane(state, ui);
      updateAskFooter(ui, state, 'Conversation cleared');
      ui.screen.render();
      return true;

    case 'clear':
      state.currentProject = undefined;
      state.currentContentType = undefined;
      renderAskPane(state, ui);
      updateAskFooter(ui, state, 'Filters cleared');
      ui.screen.render();
      return true;

    case 'p':
    case 'project': {
      if (!arg) {
        // Show interactive project picker
        state.pickerReturnMode = 'ask';
        ui.askInput.hide();
        ui.askPane.hide();
        showProjectPicker(state, ui, dbPath);
        return true;
      }
      state.currentProject = arg;
      renderAskPane(state, ui);
      updateAskFooter(ui, state, `Project set to: ${arg}`);
      ui.screen.render();
      return true;
    }

    case 't':
    case 'type': {
      if (!arg) {
        // Show interactive content type picker
        state.pickerReturnMode = 'ask';
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
      renderAskPane(state, ui);
      updateAskFooter(ui, state, `Type set to: ${arg}`);
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
 * Prompt for next input after a response
 */
export function promptForFollowUp(state: BrowserState, ui: UIComponents): void {
  ui.askInput.show();
  ui.askInput.setValue('');
  ui.askInput.focus();
  ui.askInput.readInput();
  updateAskFooter(ui, state);
  ui.screen.render();
}

/**
 * Execute the ask query with streaming
 */
export async function executeAsk(
  state: BrowserState,
  ui: UIComponents,
  dbPath: string,
  query: string
): Promise<void> {
  const trimmed = query.trim();
  if (!trimmed) {
    renderAskPane(state, ui);
    promptForFollowUp(state, ui);
    return;
  }

  // Check for slash commands
  if (await handleSlashCommand(trimmed, state, ui, dbPath)) {
    promptForFollowUp(state, ui);
    return;
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    ui.askPane.setContent('{red-fg}Error: ANTHROPIC_API_KEY not set{/red-fg}');
    ui.screen.render();
    return;
  }

  state.askQuery = trimmed;
  state.askStreaming = true;
  state.askResponse = '';

  ui.askInput.hide();
  renderAskPane(state, ui);
  updateAskFooter(ui, state, 'Searching knowledge base...');
  ui.screen.render();

  try {
    // Detect temporal intent for recency boosting
    const temporal = detectTemporalIntent(trimmed);

    // Search for relevant sources
    const embedding = await generateEmbedding(trimmed);
    let sources = await searchSources(dbPath, embedding, {
      limit: 20,
      project: state.currentProject || undefined,
      content_type: state.currentContentType as any || undefined,
      queryText: trimmed,
      mode: 'hybrid',
      recency_boost: temporal.recencyBoost,
    });

    // Re-sort by date if temporal intent detected
    if (temporal.sortByDate) {
      sources = sortByRecency(sources);
    }

    // Double-check content type filter
    if (state.currentContentType) {
      sources = sources.filter(s => s.content_type === state.currentContentType);
    }

    if (sources.length === 0) {
      state.askStreaming = false;
      // Add to history as a failed query
      state.askHistory.push({ role: 'user', content: trimmed });
      state.askHistory.push({ role: 'assistant', content: 'No relevant sources found for this query.' });
      renderAskPane(state, ui);
      promptForFollowUp(state, ui);
      return;
    }

    // Build source context
    const sourceContext = sources.map((s, i) => {
      const parts = [`[Source ${i + 1}: ${s.title}]`, `Date: ${formatDate(s.created_at)}`];
      if (s.summary) parts.push(`Summary: ${s.summary}`);
      if (s.themes?.length) {
        parts.push(`Themes: ${s.themes.map(t => t.name).join(', ')}`);
        for (const theme of s.themes.slice(0, 3)) {
          if (theme.summary) {
            parts.push(`  ${theme.name}: ${theme.summary}`);
          }
        }
      }
      if (s.quotes?.length) {
        parts.push('Key quotes:');
        for (const q of s.quotes.slice(0, 8)) {
          const speaker = q.speaker_name || q.speaker || '';
          const speakerPrefix = speaker ? `[${speaker}] ` : '';
          parts.push(`  ${speakerPrefix}"${q.text}"`);
        }
      }
      return parts.join('\n');
    }).join('\n\n---\n\n');

    updateAskFooter(ui, state, `Found ${sources.length} sources. Thinking...`);
    ui.screen.render();

    // Build messages array with history for multi-turn
    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];

    // Add conversation history (without source context for brevity)
    for (const msg of state.askHistory) {
      messages.push({ role: msg.role, content: msg.content });
    }

    // Add current question with source context
    messages.push({
      role: 'user',
      content: `Question: ${trimmed}\n\n---\nSources:\n${sourceContext}`,
    });

    // Stream response
    const anthropic = new Anthropic();
    const stream = anthropic.messages.stream({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages,
    });

    let response = '';

    stream.on('text', (text) => {
      response += text;
      state.askResponse = response;
      renderAskPane(state, ui);
      ui.screen.render();
    });

    await stream.finalMessage();

    state.askStreaming = false;

    // Add to conversation history
    state.askHistory.push({ role: 'user', content: trimmed });
    state.askHistory.push({ role: 'assistant', content: response });
    state.askResponse = '';

    renderAskPane(state, ui);
    promptForFollowUp(state, ui);

  } catch (error) {
    state.askStreaming = false;
    const errorMsg = error instanceof Error ? error.message : String(error);
    state.askHistory.push({ role: 'user', content: trimmed });
    state.askHistory.push({ role: 'assistant', content: `Error: ${errorMsg}` });
    renderAskPane(state, ui);
    promptForFollowUp(state, ui);
  }
}
