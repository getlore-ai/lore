/**
 * Lore - Agentic Research using Claude Agent SDK
 *
 * This is the "real" agent that:
 * 1. Takes a research task
 * 2. Uses Lore's own tools iteratively (search, get_source, list_sources)
 * 3. Follows leads, cross-references, refines queries
 * 4. Synthesizes findings into a comprehensive research package
 */

import { query, tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { searchSources, getSourceById, getAllSources } from '../../core/vector-store.js';
import { generateEmbedding } from '../../core/embedder.js';
import { loadArchivedProjects } from './archive-project.js';
import type { ResearchPackage, Quote, SourceType, Theme } from '../../core/types.js';

interface ResearchAgentArgs {
  task: string;
  project?: string;
  content_type?: string;
  include_sources?: boolean;
}

// Agent will self-terminate when it has enough evidence
// This is a safety limit to prevent runaway loops
const MAX_TURNS = 50;

/**
 * Create the Lore tools MCP server for the research agent
 */
function createLoreToolsServer(dbPath: string, dataDir: string, archivedProjects: string[]) {
  return createSdkMcpServer({
    name: 'lore-tools',
    version: '1.0.0',
    tools: [
      // Search tool - semantic search across sources
      tool(
        'search',
        'Semantic search across all sources in the knowledge repository. Returns summaries with relevant quotes. Use this to find information related to a topic.',
        {
          query: z.string().describe('Semantic search query - describe what you\'re looking for'),
          source_type: z
            .enum(['granola', 'claude-code', 'claude-desktop', 'chatgpt', 'markdown', 'document'])
            .optional()
            .describe('Filter by source type (e.g., "granola" for meeting transcripts)'),
          content_type: z
            .enum(['interview', 'meeting', 'conversation', 'document', 'note', 'analysis'])
            .optional()
            .describe('Filter by content type (e.g., "interview" for user interviews)'),
          project: z.string().optional().describe('Filter to specific project'),
          limit: z.number().optional().describe('Max results (default 10)'),
        },
        async (args) => {
          try {
            const queryVector = await generateEmbedding(args.query);
            const results = await searchSources(dbPath, queryVector, {
              limit: args.limit || 10,
              project: args.project,
              source_type: args.source_type as SourceType | undefined,
              content_type: args.content_type as any,
            });

            // Filter out archived projects
            const filtered = results.filter((r) => {
              return !r.projects.some((p) => archivedProjects.includes(p.toLowerCase()));
            });

            if (filtered.length === 0) {
              return {
                content: [{ type: 'text', text: 'No results found for this query.' }],
              };
            }

            const resultText = filtered
              .map((r, i) => {
                const quotes = r.quotes.slice(0, 3).map((q) => `  - "${q.text.substring(0, 150)}..."`).join('\n');
                return `${i + 1}. **${r.title}** (${r.source_type}, score: ${(r.score * 100).toFixed(0)}%)
   ID: ${r.id}
   Projects: ${r.projects.join(', ') || 'none'}
   Summary: ${r.summary.substring(0, 200)}...
   Key quotes:
${quotes}`;
              })
              .join('\n\n');

            return {
              content: [{ type: 'text', text: `Found ${filtered.length} results:\n\n${resultText}` }],
            };
          } catch (error) {
            return {
              content: [{ type: 'text', text: `Search error: ${error}` }],
            };
          }
        }
      ),

      // Get source - retrieve full details of a specific source
      tool(
        'get_source',
        'Get full details of a specific source document including all quotes, themes, and summary. Use this to dive deeper into a specific source found via search.',
        {
          source_id: z.string().describe('ID of the source document (from search results)'),
        },
        async (args) => {
          try {
            const source = await getSourceById(dbPath, args.source_id);
            if (!source) {
              return {
                content: [{ type: 'text', text: `Source not found: ${args.source_id}` }],
              };
            }

            const themes = source.themes.map((t: Theme) => `- ${t.name}: ${t.evidence.length} pieces of evidence`).join('\n');
            const quotes = source.quotes
              .slice(0, 10)
              .map((q: Quote) => `- [${q.speaker || 'unknown'}] "${q.text}"`)
              .join('\n');

            return {
              content: [
                {
                  type: 'text',
                  text: `# ${source.title}

**Type:** ${source.source_type} / ${source.content_type}
**Created:** ${source.created_at}
**Projects:** ${source.projects.join(', ') || 'none'}

## Summary
${source.summary}

## Themes
${themes || 'No themes extracted'}

## Key Quotes
${quotes || 'No quotes extracted'}`,
                },
              ],
            };
          } catch (error) {
            return {
              content: [{ type: 'text', text: `Error getting source: ${error}` }],
            };
          }
        }
      ),

      // List sources - browse available sources
      tool(
        'list_sources',
        'List all sources in the repository. Use this to understand what knowledge is available before searching.',
        {
          source_type: z
            .enum(['granola', 'claude-code', 'claude-desktop', 'chatgpt', 'markdown', 'document'])
            .optional()
            .describe('Filter by source type'),
          project: z.string().optional().describe('Filter to specific project'),
          limit: z.number().optional().describe('Max results (default 20)'),
        },
        async (args) => {
          try {
            const sources = await getAllSources(dbPath, {
              source_type: args.source_type as SourceType | undefined,
              project: args.project,
              limit: args.limit || 20,
            });

            // Filter out archived
            const filtered = sources.filter((s) => {
              return !s.projects.some((p) => archivedProjects.includes(p.toLowerCase()));
            });

            if (filtered.length === 0) {
              return {
                content: [{ type: 'text', text: 'No sources found matching criteria.' }],
              };
            }

            const listText = filtered
              .map((s, i) => {
                return `${i + 1}. **${s.title}** (${s.source_type})
   ID: ${s.id}
   Created: ${s.created_at}
   Projects: ${s.projects.join(', ') || 'none'}`;
              })
              .join('\n\n');

            return {
              content: [{ type: 'text', text: `Found ${filtered.length} sources:\n\n${listText}` }],
            };
          } catch (error) {
            return {
              content: [{ type: 'text', text: `Error listing sources: ${error}` }],
            };
          }
        }
      ),
    ],
  });
}

/**
 * Research agent system prompt
 */
function getResearchSystemPrompt(task: string, project?: string): string {
  return `You are a research agent for Lore, a knowledge repository containing user interviews, meeting transcripts, AI conversations, and documents.

Your task is to conduct comprehensive research and produce a well-cited research package.

## Research Task
${task}
${project ? `\nFocus on project: ${project}` : ''}

## Your Tools
- **search**: Semantic search across all sources. Start broad, then refine.
- **get_source**: Dive deep into a specific source for full context and quotes.
- **list_sources**: See what knowledge is available.

## Research Methodology

1. **Explore First**: Start with broad searches to understand what's available.
2. **Follow Leads**: When you find relevant sources, use get_source to read more and gather quotes.
3. **Cross-Reference**: Look for patterns across multiple sources.
4. **Identify Conflicts**: Note when sources disagree - prefer newer sources.
5. **Synthesize When Ready**: When you feel you have sufficient evidence to answer the research task comprehensively, produce your findings.

## Output Requirements

When you have gathered sufficient evidence, provide your findings in this exact JSON format:

\`\`\`json
{
  "summary": "A comprehensive 2-3 paragraph summary of findings",
  "key_findings": ["Finding 1 with citation", "Finding 2 with citation", ...],
  "conflicts_resolved": ["Description of any conflicts and how they were resolved"],
  "supporting_quotes": [
    {
      "text": "The exact quote",
      "speaker": "who said it",
      "source_id": "source document ID",
      "source_title": "title of the source"
    }
  ],
  "sources_consulted": [
    {
      "id": "source ID",
      "title": "source title",
      "relevance": "why this was useful"
    }
  ],
  "gaps_identified": ["What information is missing or unclear"],
  "suggested_queries": ["Follow-up research questions"]
}
\`\`\`

## Important Guidelines

- ALWAYS cite your sources - every claim should reference a specific source
- When sources conflict, note the conflict and prefer the more recent source
- Be thorough - use multiple searches with different queries
- Include direct quotes as evidence
- Identify what you DIDN'T find (gaps)
- Suggest follow-up questions

Now begin your research. Use the tools iteratively until you have comprehensive findings.`;
}

/**
 * Run the agentic research
 */
export async function runResearchAgent(
  dbPath: string,
  dataDir: string,
  args: ResearchAgentArgs
): Promise<ResearchPackage> {
  const { task, project, include_sources = true } = args;

  // Load archived projects to filter (extract just the project names)
  const archivedProjectsData = await loadArchivedProjects(dataDir);
  const archivedProjects = archivedProjectsData.map((p) => p.project.toLowerCase());

  // Create the Lore tools server
  const loreTools = createLoreToolsServer(dbPath, dataDir, archivedProjects);

  // System prompt
  const systemPrompt = getResearchSystemPrompt(task, project);

  let finalResult: ResearchPackage | null = null;
  let lastAssistantMessage = '';

  try {
    // Run the agent
    for await (const message of query({
      prompt: `Research task: ${task}${project ? ` (project: ${project})` : ''}`,
      options: {
        systemPrompt,
        mcpServers: {
          'lore-tools': loreTools,
        },
        allowedTools: [
          'mcp__lore-tools__search',
          'mcp__lore-tools__get_source',
          'mcp__lore-tools__list_sources',
        ],
        maxTurns: MAX_TURNS,
        permissionMode: 'acceptEdits', // Auto-approve tool calls
      },
    })) {
      // Capture assistant messages (intermediate)
      if (message.type === 'assistant') {
        const msg = message as any;
        if (msg.message?.content) {
          const content = msg.message.content;
          if (typeof content === 'string') {
            lastAssistantMessage = content;
          } else if (Array.isArray(content)) {
            const textBlocks = content.filter((b: any) => b.type === 'text');
            if (textBlocks.length > 0) {
              lastAssistantMessage = textBlocks.map((b: any) => b.text).join('\n');
            }
          }
        }
      }

      // Capture the final result message
      if (message.type === 'result') {
        const msg = message as any;
        if (msg.subtype === 'success' && msg.result) {
          lastAssistantMessage = msg.result;
          console.error(`[research-agent] Completed in ${msg.num_turns} turns`);
        } else if (msg.subtype?.startsWith('error')) {
          console.error(`[research-agent] Error: ${msg.subtype}`, msg.errors);
        }
      }

      // Log tool usage for debugging
      if (message.type === 'tool_use_summary') {
        const msg = message as any;
        console.error(`[research-agent] Tool: ${msg.tool_name || 'unknown'}`);
      }
    }

    // Parse the final result from the agent's output
    finalResult = parseResearchOutput(lastAssistantMessage, task, project);
  } catch (error) {
    console.error('[research-agent] Error:', error);
    // Return a minimal result on error
    finalResult = {
      query: task,
      project,
      generated_at: new Date().toISOString(),
      summary: `Research failed: ${error}`,
      key_findings: [],
      supporting_quotes: [],
      related_decisions: [],
      sources_consulted: [],
      gaps_identified: ['Research could not be completed due to an error'],
    };
  }

  return finalResult;
}

/**
 * Parse the agent's output into a ResearchPackage
 */
function parseResearchOutput(
  output: string,
  task: string,
  project?: string
): ResearchPackage {
  // Try to extract JSON from the output
  const jsonMatch = output.match(/```json\s*([\s\S]*?)\s*```/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1]);
      return {
        query: task,
        project,
        generated_at: new Date().toISOString(),
        summary: parsed.summary || '',
        key_findings: parsed.key_findings || [],
        conflicts_resolved: parsed.conflicts_resolved || [],
        supporting_quotes: (parsed.supporting_quotes || []).map((q: any) => ({
          id: `quote_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          text: q.text,
          speaker: q.speaker,
          citation: {
            source_id: q.source_id,
            context: q.source_title,
          },
        })),
        related_decisions: [],
        sources_consulted: (parsed.sources_consulted || []).map((s: any) => ({
          id: s.id,
          title: s.title,
          source_type: 'document' as SourceType,
          relevance: 0.8,
        })),
        gaps_identified: parsed.gaps_identified || [],
        suggested_queries: parsed.suggested_queries || [],
      };
    } catch (e) {
      console.error('[research-agent] Failed to parse JSON output:', e);
    }
  }

  // Fallback: return the raw output as summary
  return {
    query: task,
    project,
    generated_at: new Date().toISOString(),
    summary: output || 'No research output generated',
    key_findings: [],
    supporting_quotes: [],
    related_decisions: [],
    sources_consulted: [],
    gaps_identified: ['Could not parse structured output from research agent'],
  };
}
