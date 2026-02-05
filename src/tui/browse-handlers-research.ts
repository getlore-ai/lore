/**
 * Research handlers for the Lore Document Browser TUI
 *
 * Spawns the full agentic research mode for comprehensive,
 * iterative research with citations.
 */

import type { BrowserState, UIComponents } from './browse-types.js';
import { handleResearch } from '../mcp/handlers/research.js';
import type { ResearchPackage } from '../core/types.js';

/**
 * Enter research mode - show input for research task
 */
export function enterResearchMode(state: BrowserState, ui: UIComponents): void {
  state.mode = 'research';
  state.researchQuery = '';
  state.researchRunning = false;

  // Hide list/preview panes
  ui.listPane.hide();
  ui.previewPane.hide();

  // Reuse ask UI components
  ui.askInput.show();
  ui.askPane.show();
  ui.askPane.setLabel(' Research Agent ');
  ui.askPane.setContent('{cyan-fg}Enter research task and press Enter{/cyan-fg}\n\n{gray-fg}The research agent will iteratively explore sources,\ncross-reference findings, and synthesize results.{/gray-fg}');

  ui.footer.setContent(' Enter: Research  │  Esc: Cancel');

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

  ui.askInput.hide();
  ui.askInput.setValue('');
  ui.askPane.hide();
  ui.askPane.setLabel(' Response ');

  ui.listPane.show();
  ui.previewPane.show();

  ui.footer.setContent(' ↑↓ Navigate │ Enter View │ / Search │ a Ask │ R Research │ p Projects │ q Quit │ ? Help');
  ui.listContent.focus();
  ui.screen.render();
}

/**
 * Format research package for display
 */
function formatResearchResult(result: ResearchPackage): string {
  const lines: string[] = [];

  // Summary
  lines.push('## Summary\n');
  lines.push(result.summary);
  lines.push('');

  // Key findings
  if (result.key_findings?.length) {
    lines.push('\n## Key Findings\n');
    for (const finding of result.key_findings) {
      lines.push(`• ${finding}`);
    }
  }

  // Conflicts resolved
  if (result.conflicts_resolved?.length) {
    lines.push('\n\n## Conflicts Resolved\n');
    for (const conflict of result.conflicts_resolved) {
      lines.push(`• ${conflict}`);
    }
  }

  // Supporting quotes
  if (result.supporting_quotes?.length) {
    lines.push('\n\n## Supporting Quotes\n');
    for (const quote of result.supporting_quotes.slice(0, 10)) {
      const speaker = quote.speaker_name || quote.speaker || 'Unknown';
      lines.push(`"${quote.text}"`);
      lines.push(`  — ${speaker}${quote.citation?.context ? ` (${quote.citation.context})` : ''}\n`);
    }
  }

  // Sources consulted
  if (result.sources_consulted?.length) {
    lines.push('\n## Sources Consulted\n');
    for (const source of result.sources_consulted) {
      const relevance = source.relevance ? ` (${(source.relevance * 100).toFixed(0)}%)` : '';
      lines.push(`• ${source.title}${relevance}`);
    }
  }

  // Gaps identified
  if (result.gaps_identified?.length) {
    lines.push('\n\n## Gaps Identified\n');
    for (const gap of result.gaps_identified) {
      lines.push(`• ${gap}`);
    }
  }

  // Suggested queries
  if (result.suggested_queries?.length) {
    lines.push('\n\n## Suggested Follow-up Queries\n');
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
  if (!query.trim()) {
    ui.askPane.setContent('{red-fg}Please enter a research task{/red-fg}');
    ui.screen.render();
    return;
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    ui.askPane.setContent('{red-fg}Error: ANTHROPIC_API_KEY not set{/red-fg}');
    ui.screen.render();
    return;
  }

  state.researchQuery = query;
  state.researchRunning = true;

  ui.askInput.hide();
  ui.askPane.setLabel(' Research Agent ');
  ui.askPane.setContent('{yellow-fg}Starting research agent...{/yellow-fg}\n\n{gray-fg}This may take a moment as the agent explores sources.{/gray-fg}');
  ui.footer.setContent(' Researching... (agent is iterating)');
  ui.screen.render();

  try {
    // Run the full research agent
    const result = await handleResearch(dbPath, dataDir, {
      task: query,
      project: state.currentProject || undefined,
      include_sources: true,
    }, { hookContext: { mode: 'cli' } });

    state.researchRunning = false;

    // Format and display result
    const formatted = formatResearchResult(result);
    state.researchResponse = formatted;

    // Escape blessed tags for display
    const displayText = formatted
      .replace(/\{/g, '\\{')
      .replace(/\}/g, '\\}');

    ui.askPane.setContent(displayText);
    ui.footer.setContent(' y: Copy  │  Esc: Back  │  R: New research');
    ui.screen.render();

  } catch (error) {
    state.researchRunning = false;
    const errorMsg = error instanceof Error ? error.message : String(error);
    ui.askPane.setContent(`{red-fg}Error: ${errorMsg}{/red-fg}`);
    ui.footer.setContent(' y: Copy  │  Esc: Back  │  R: New research');
    ui.screen.render();
  }
}
