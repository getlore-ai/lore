/**
 * Ask handlers for the Lore Document Browser TUI
 *
 * Handles AI-powered queries with streaming responses.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { BrowserState, UIComponents } from './browse-types.js';
import { searchSources } from '../core/vector-store.js';
import { generateEmbedding } from '../core/embedder.js';

const SYSTEM_PROMPT = `You are a research assistant with access to a knowledge base. 
Your job is to answer questions based on the provided sources.

When answering:
- Cite specific sources when making claims
- Be concise but thorough
- If the sources don't contain enough information, say so

Source format: Each source has an ID, title, and content summary.`;

/**
 * Enter ask mode - show input for query
 */
export function enterAskMode(state: BrowserState, ui: UIComponents): void {
  state.mode = 'ask';
  state.askQuery = '';
  state.askResponse = '';
  state.askStreaming = false;
  
  // Hide list/preview panes
  ui.listPane.hide();
  ui.previewPane.hide();
  
  // Show ask UI
  ui.askInput.show();
  ui.askPane.show();
  ui.askPane.setContent('{cyan-fg}Enter your question and press Enter{/cyan-fg}');
  
  ui.footer.setContent(' Enter: Ask  │  Esc: Cancel');
  
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
  
  ui.askInput.hide();
  ui.askInput.setValue('');
  ui.askPane.hide();
  
  ui.listPane.show();
  ui.previewPane.show();
  
  ui.footer.setContent(' ↑↓ Navigate │ Enter View │ / Search │ a Ask │ p Projects │ x Extensions │ q Quit │ ? Help');
  ui.listContent.focus();
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
  if (!query.trim()) {
    ui.askPane.setContent('{red-fg}Please enter a question{/red-fg}');
    ui.screen.render();
    return;
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    ui.askPane.setContent('{red-fg}Error: ANTHROPIC_API_KEY not set{/red-fg}');
    ui.screen.render();
    return;
  }

  state.askQuery = query;
  state.askStreaming = true;
  state.askResponse = '';
  
  ui.askInput.hide();
  ui.askPane.setLabel(' Response ');
  ui.askPane.setContent('{yellow-fg}Searching knowledge base...{/yellow-fg}');
  ui.footer.setContent(' Searching...');
  ui.screen.render();

  try {
    // Search for relevant sources
    const embedding = await generateEmbedding(query);
    const sources = await searchSources(dbPath, embedding, {
      limit: 10,
      project: state.currentProject || undefined,
      queryText: query,
      mode: 'hybrid',
    });

    if (sources.length === 0) {
      ui.askPane.setContent('{yellow-fg}No relevant sources found.{/yellow-fg}');
      ui.footer.setContent(' No sources  │  Esc: Back  │  a: New question');
      ui.screen.render();
      state.askStreaming = false;
      return;
    }

    // Build context
    const sourceContext = sources.map((s, i) => {
      const parts = [`[Source ${i + 1}: ${s.title}]`];
      if (s.summary) parts.push(`Summary: ${s.summary}`);
      if (s.themes?.length) parts.push(`Themes: ${s.themes.map(t => t.name).join(', ')}`);
      if (s.quotes?.length) {
        parts.push('Key quotes:');
        for (const q of s.quotes.slice(0, 3)) {
          parts.push(`  "${q.text}"`);
        }
      }
      return parts.join('\n');
    }).join('\n\n---\n\n');

    ui.askPane.setContent(`{yellow-fg}Found ${sources.length} sources. Thinking...{/yellow-fg}`);
    ui.footer.setContent(' Generating response...');
    ui.screen.render();

    // Stream response
    const anthropic = new Anthropic();
    const stream = anthropic.messages.stream({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: `Question: ${query}\n\n---\nSources:\n${sourceContext}`
      }],
    });

    let response = '';
    
    stream.on('text', (text) => {
      response += text;
      state.askResponse = response;
      // Simple escape for blessed tags
      const displayText = response
        .replace(/\{/g, '\\{')
        .replace(/\}/g, '\\}');
      ui.askPane.setContent(displayText);
      ui.screen.render();
    });

    await stream.finalMessage();
    
    state.askStreaming = false;
    state.askResponse = response;
    
    ui.footer.setContent(' Esc: Back  │  a: New question');
    ui.screen.render();

  } catch (error) {
    state.askStreaming = false;
    const errorMsg = error instanceof Error ? error.message : String(error);
    ui.askPane.setContent(`{red-fg}Error: ${errorMsg}{/red-fg}`);
    ui.footer.setContent(' Esc: Back  │  a: New question');
    ui.screen.render();
  }
}
