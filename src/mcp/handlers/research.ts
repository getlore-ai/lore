/**
 * Research Handler - LLM-powered research synthesis
 *
 * Two modes:
 * 1. AGENTIC (default): Uses Claude Agent SDK for iterative, thorough research
 * 2. SIMPLE (fallback): Single-pass search + GPT-4o-mini synthesis
 *
 * Set LORE_RESEARCH_MODE=simple to use the fallback mode.
 */

import OpenAI from 'openai';
import { searchSources, getSourceById } from '../../core/vector-store.js';
import { generateEmbedding } from '../../core/embedder.js';
import { loadArchivedProjects } from './archive-project.js';
import { runResearchAgent } from './research-agent.js';
import type { ResearchPackage, Quote, SourceType } from '../../core/types.js';
import { getExtensionRegistry } from '../../extensions/registry.js';

// Lazy initialization for OpenAI (only used in simple mode)
let openaiClient: OpenAI | null = null;

function getOpenAI(): OpenAI {
  if (!openaiClient) {
    openaiClient = new OpenAI();
  }
  return openaiClient;
}

interface ResearchArgs {
  task: string;
  project?: string;
  include_sources?: boolean;
}

interface SynthesisResult {
  summary: string;
  key_findings: string[];
  conflicts_resolved: string[];
  gaps_identified: string[];
  suggested_queries: string[];
}

/**
 * Use LLM to synthesize research findings with conflict awareness
 */
async function synthesizeFindings(
  task: string,
  sources: Array<{ id: string; title: string; summary: string; source_type: SourceType; created_at: string }>,
  quotes: Quote[],
  decisions: Array<{ content: string; source_id: string }>
): Promise<SynthesisResult> {
  // Sort sources by date for context (newest first in display)
  const sortedSources = [...sources].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  const sourceSummaries = sortedSources
    .map((s, i) => {
      const date = new Date(s.created_at).toLocaleDateString();
      return `[${i + 1}] "${s.title}" (${s.source_type}, ${date}): ${s.summary}`;
    })
    .join('\n\n');

  const quoteTexts = quotes
    .slice(0, 15)
    .map((q, i) => {
      const speaker = q.speaker === 'user' ? '[User]' : '[Participant]';
      return `${i + 1}. ${speaker} "${q.text}"${q.theme ? ` (Theme: ${q.theme})` : ''}`;
    })
    .join('\n');

  const decisionTexts = decisions
    .map((d, i) => `${i + 1}. ${d.content}`)
    .join('\n');

  const prompt = `You are a research analyst synthesizing findings from user research and conversations.

RESEARCH TASK: ${task}

SOURCES FOUND (${sources.length}, sorted newest first):
${sourceSummaries || 'No sources found.'}

KEY QUOTES (${quotes.length} total, showing top 15):
${quoteTexts || 'No quotes found.'}

RELATED DECISIONS:
${decisionTexts || 'No decisions found.'}

Based on this evidence, provide a research synthesis in the following JSON format:
{
  "summary": "A 2-3 sentence executive summary answering the research task with the CURRENT understanding",
  "key_findings": ["Finding 1 with evidence", "Finding 2 with evidence", "Finding 3 with evidence"],
  "conflicts_resolved": ["Description of any conflicting info and how it was resolved, e.g., 'Earlier (Jan 5) the approach was X, but a later decision (Jan 15) changed to Y. Current approach: Y'"],
  "gaps_identified": ["Gap or unanswered question 1", "Gap 2"],
  "suggested_queries": ["Follow-up research query 1", "Query 2"]
}

CRITICAL GUIDELINES:
- When sources contain CONFLICTING information, ALWAYS prefer the more recent source
- If you detect a pivot, decision change, or evolution in thinking, note it in conflicts_resolved
- The summary should reflect the CURRENT understanding, not historical positions
- Key findings should reflect the latest thinking, while acknowledging evolution where relevant
- If older sources contradict newer decisions, the newer decision takes precedence
- Include dates when noting conflicts or changes (e.g., "As of Jan 15, the approach is X")
- Be transparent about what changed and when - this helps users understand the lineage

Respond with only the JSON object.`;

  try {
    const response = await getOpenAI().chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('No response from LLM');
    }

    const result = JSON.parse(content) as SynthesisResult;
    return {
      summary: result.summary || `Research on "${task}" found ${sources.length} sources.`,
      key_findings: result.key_findings || [],
      conflicts_resolved: result.conflicts_resolved || [],
      gaps_identified: result.gaps_identified || [],
      suggested_queries: result.suggested_queries || [],
    };
  } catch (error) {
    console.error('Error synthesizing findings:', error);
    // Fallback to simple synthesis
    return {
      summary: `Research on "${task}" found ${sources.length} relevant sources with ${quotes.length} supporting quotes.`,
      key_findings: sources.slice(0, 3).map((s) => s.summary),
      conflicts_resolved: [],
      gaps_identified: [],
      suggested_queries: [],
    };
  }
}

export async function handleResearch(
  dbPath: string,
  dataDir: string,
  args: ResearchArgs,
  options: { hookContext?: { mode: 'mcp' | 'cli' } } = {}
): Promise<ResearchPackage> {
  const { task, project, include_sources = true } = args;

  // Check if we should use agentic mode (default) or simple mode (fallback)
  const useAgenticMode = process.env.LORE_RESEARCH_MODE !== 'simple';

  if (useAgenticMode) {
    console.error('[research] Using agentic mode (Claude Agent SDK)');
    try {
      const result = await runResearchAgent(dbPath, dataDir, args);
      await runResearchCompletedHook(result, {
        mode: options.hookContext?.mode || 'mcp',
        dataDir,
        dbPath,
      });
      return result;
    } catch (error) {
      console.error('[research] Agentic mode failed, falling back to simple mode:', error);
      // Fall through to simple mode
    }
  }

  console.error('[research] Using simple mode (single-pass synthesis)');
  const result = await handleResearchSimple(dbPath, dataDir, args);
  await runResearchCompletedHook(result, {
    mode: options.hookContext?.mode || 'mcp',
    dataDir,
    dbPath,
  });
  return result;
}

/**
 * Simple research mode - single pass search + synthesis
 * This is the fallback when agentic mode fails or is disabled
 */
async function handleResearchSimple(
  dbPath: string,
  dataDir: string,
  args: ResearchArgs
): Promise<ResearchPackage> {
  const { task, project, include_sources = true } = args;

  // Use sensible defaults for simple mode
  const sourceLimit = 10;
  const quoteLimit = 25;

  // Load archived projects to filter them out
  const archivedProjects = await loadArchivedProjects(dataDir);
  const archivedNames = new Set(archivedProjects.map((p) => p.project.toLowerCase()));

  // Step 1: Search for relevant sources (fetch extra to account for archived filtering)
  const queryVector = await generateEmbedding(task);
  const rawSources = await searchSources(dbPath, queryVector, {
    limit: sourceLimit * 2,
    project,
  });

  // Filter out archived projects
  const sources = rawSources
    .filter((s) => !s.projects.some((p) => archivedNames.has(p.toLowerCase())))
    .slice(0, sourceLimit);

  // Step 2: Gather quotes from found sources (quotes are stored in source.quotes_json)
  const allQuotes: Quote[] = [];
  for (const source of sources) {
    for (const quote of source.quotes) {
      allQuotes.push({
        ...quote,
        citation: {
          source_id: source.id,
          context: source.title,
        },
      });
    }
  }

  // Step 3: Synthesize findings with LLM (conflict-aware)
  // Note: Decisions are now extracted at query time by the agentic research mode
  const synthesis = await synthesizeFindings(
    task,
    sources.map((s) => ({
      id: s.id,
      title: s.title,
      summary: s.summary,
      source_type: s.source_type,
      created_at: s.created_at,
    })),
    allQuotes,
    [] // No pre-indexed decisions - agentic mode extracts them dynamically
  );

  const researchPackage: ResearchPackage = {
    query: task,
    project,
    generated_at: new Date().toISOString(),

    // LLM-synthesized findings
    summary: synthesis.summary,
    key_findings: synthesis.key_findings,

    // Conflict resolution (shows evolution of thinking)
    conflicts_resolved:
      synthesis.conflicts_resolved.length > 0 ? synthesis.conflicts_resolved : undefined,

    // Evidence
    supporting_quotes: allQuotes.slice(0, quoteLimit),
    related_decisions: [],

    // Sources
    sources_consulted: include_sources
      ? sources.map((s) => ({
          id: s.id,
          title: s.title,
          source_type: s.source_type,
          relevance: s.score,
        }))
      : [],

    // LLM-identified gaps and suggestions
    gaps_identified: synthesis.gaps_identified,
    suggested_queries: synthesis.suggested_queries,
  };

  return researchPackage;
}

async function runResearchCompletedHook(
  result: ResearchPackage,
  context: { mode: 'mcp' | 'cli'; dataDir: string; dbPath: string }
): Promise<void> {
  try {
    const registry = await getExtensionRegistry({
      logger: (message) => console.error(message),
    });
    await registry.runHook('onResearchCompleted', result, {
      mode: context.mode,
      dataDir: context.dataDir,
      dbPath: context.dbPath,
    });
  } catch (error) {
    console.error('[extensions] Failed to run onResearchCompleted hook:', error);
  }
}
