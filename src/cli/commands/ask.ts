/**
 * lore ask - AI-powered query of the knowledge base
 * 
 * Searches relevant sources and uses AI to synthesize an answer.
 */

import Anthropic from '@anthropic-ai/sdk';
import { Command } from 'commander';
import { searchSources } from '../../core/vector-store.js';
import { generateEmbedding } from '../../core/embedder.js';

interface AskOptions {
  project?: string;
  maxSources?: string;
  model?: string;
  verbose?: boolean;
}

const SYSTEM_PROMPT = `You are a research assistant with access to a knowledge base. 
Your job is to answer questions based on the provided sources.

When answering:
- Cite specific sources when making claims
- Be concise but thorough
- If the sources don't contain enough information, say so

Source format: Each source has an ID, title, and content summary.`;

export function registerAskCommand(program: Command, dataDir: string): void {
  const dbPath = `${dataDir}/lore.lance`;

  program
    .command('ask <question...>')
    .description('Ask questions about your knowledge base')
    .option('-p, --project <name>', 'Filter sources by project')
    .option('-n, --max-sources <n>', 'Maximum sources to include', '10')
    .option('-m, --model <model>', 'AI model to use', 'claude-sonnet-4-20250514')
    .option('-v, --verbose', 'Show source details')
    .action(async (questionParts: string[], options: AskOptions) => {
      const question = questionParts.join(' ');
      
      if (!process.env.ANTHROPIC_API_KEY) {
        console.error('Error: ANTHROPIC_API_KEY environment variable required');
        process.exit(1);
      }

      const maxSources = parseInt(options.maxSources || '10', 10);
      
      try {
        // Search for relevant sources
        console.error('Searching knowledge base...');
        const embedding = await generateEmbedding(question);
        
        const sources = await searchSources(dbPath, embedding, {
          limit: maxSources,
          project: options.project,
          queryText: question,
          mode: 'hybrid',
        });

        if (sources.length === 0) {
          console.error('No relevant sources found.');
          if (options.project) {
            console.error(`(Filtered by project: ${options.project})`);
          }
          process.exit(1);
        }

        console.error(`Found ${sources.length} relevant sources`);
        
        if (options.verbose) {
          console.error('\nSources:');
          for (const source of sources) {
            console.error(`  - ${source.title} (${source.id})`);
          }
          console.error('');
        }

        // Build context from sources
        const sourceContext = sources.map((s, i) => {
          const parts = [`[Source ${i + 1}: ${s.title}]`, `ID: ${s.id}`];
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

        // Stream response
        console.error('Thinking...\n');
        const anthropic = new Anthropic();
        
        const stream = anthropic.messages.stream({
          model: options.model || 'claude-sonnet-4-20250514',
          max_tokens: 4096,
          system: SYSTEM_PROMPT,
          messages: [{
            role: 'user',
            content: `Question: ${question}\n\n---\nSources:\n${sourceContext}`
          }],
        });

        stream.on('text', (text) => {
          process.stdout.write(text);
        });
        
        await stream.finalMessage();
        console.log('');

      } catch (error) {
        console.error('Error:', error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });
}
