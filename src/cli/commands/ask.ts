/**
 * lore ask - AI-powered query and modification of the knowledge base
 * 
 * Query mode (default): Ask questions, get answers
 * Edit mode (--save): Create/modify/delete with approval queue
 */

import Anthropic from '@anthropic-ai/sdk';
import { Command } from 'commander';
import { searchSources, getSourceById } from '../../core/vector-store.js';
import { generateEmbedding } from '../../core/embedder.js';
import { createProposal } from '../../extensions/proposals.js';

interface AskOptions {
  project?: string;
  maxSources?: string;
  save?: boolean;
  title?: string;
  model?: string;
  verbose?: boolean;
}

const SYSTEM_PROMPT = `You are a research assistant with access to a knowledge base. 
Your job is to answer questions based on the provided sources.

When answering:
- Cite specific sources when making claims
- Be concise but thorough
- If the sources don't contain enough information, say so
- If asked to create/modify/delete content, describe what you would do

Source format: Each source has an ID, title, and content summary.`;

const EDIT_SYSTEM_PROMPT = `You are a research assistant that can create new documents for a knowledge base.

When asked to create a document:
- Generate well-structured markdown content
- Include relevant insights from the provided sources
- Cite sources where appropriate
- Use clear headings and organization

Respond with ONLY the document content (markdown), no preamble or explanation.`;

export function registerAskCommand(program: Command, dataDir: string): void {
  const dbPath = `${dataDir}/lore.lance`;

  program
    .command('ask <question...>')
    .description('Ask questions or make changes to the knowledge base')
    .option('-p, --project <name>', 'Filter sources by project')
    .option('-n, --max-sources <n>', 'Maximum sources to include', '10')
    .option('-s, --save', 'Save result as new document (requires approval)')
    .option('-t, --title <title>', 'Title for saved document')
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

        // Build context from sources - use summary + themes + quotes
        const sourceContext = sources.map((s, i) => {
          const parts = [`[Source ${i + 1}: ${s.title}]`, `ID: ${s.id}`];
          
          if (s.summary) {
            parts.push(`Summary: ${s.summary}`);
          }
          
          if (s.themes && s.themes.length > 0) {
            parts.push(`Themes: ${s.themes.map(t => t.name).join(', ')}`);
          }
          
          if (s.quotes && s.quotes.length > 0) {
            parts.push('Key quotes:');
            for (const q of s.quotes.slice(0, 3)) {
              parts.push(`  "${q.text}"`);
            }
          }
          
          return parts.join('\n');
        }).join('\n\n---\n\n');

        // Call AI with streaming
        console.error('Thinking...\n');
        const anthropic = new Anthropic();
        
        const systemPrompt = options.save ? EDIT_SYSTEM_PROMPT : SYSTEM_PROMPT;
        const userMessage = options.save 
          ? `Based on these sources, create the following:\n\n${question}\n\n---\nSources:\n${sourceContext}`
          : `Question: ${question}\n\n---\nSources:\n${sourceContext}`;

        let answer = '';
        
        // Stream the response
        const stream = anthropic.messages.stream({
          model: options.model || 'claude-sonnet-4-20250514',
          max_tokens: 4096,
          system: systemPrompt,
          messages: [{ role: 'user', content: userMessage }],
        });

        // Print tokens as they arrive (only in query mode, not save mode)
        if (!options.save) {
          stream.on('text', (text) => {
            process.stdout.write(text);
            answer += text;
          });
          
          await stream.finalMessage();
          console.log(''); // Final newline
        } else {
          // For save mode, collect silently then show at end
          stream.on('text', (text) => {
            answer += text;
          });
          await stream.finalMessage();
        }

        if (options.save) {
          // Create proposal for new document
          const title = options.title || `Analysis: ${question.slice(0, 50)}${question.length > 50 ? '...' : ''}`;
          
          const proposal = await createProposal('lore-ask', {
            type: 'create_source',
            title,
            content: answer,
            project: options.project || 'default',
            reason: `Created via: lore ask "${question}"`,
          });

          console.log(`\n📋 Proposal created: ${proposal.id}`);
          console.log(`   Title: ${title}`);
          console.log(`\nReview with: lore pending show ${proposal.id}`);
          console.log(`Approve with: lore pending approve ${proposal.id}`);
          console.log(`Or use TUI: lore browse → r (review)`);
          
          if (options.verbose) {
            console.log('\n--- Preview ---');
            console.log(answer);
          }
        } else {
          // Just print the answer
          console.log(answer);
        }

      } catch (error) {
        console.error('Error:', error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });
}
