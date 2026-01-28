/**
 * Research Handler - Agentic research using Claude Agent SDK
 *
 * This is the "smart" tool that uses an internal agent to:
 * 1. Search across multiple sources
 * 2. Cross-reference findings
 * 3. Synthesize a research package with citations
 */

import { searchSources, searchChunks, getSourceById } from '../../core/vector-store.js';
import { generateEmbedding } from '../../core/embedder.js';
import type { ResearchPackage, Quote } from '../../core/types.js';

interface ResearchArgs {
  task: string;
  project?: string;
  depth?: 'quick' | 'thorough' | 'exhaustive';
  include_sources?: boolean;
}

/**
 * For now, this is a simpler implementation that does multi-step search.
 * TODO: Replace with actual Claude Agent SDK for more sophisticated reasoning.
 */
export async function handleResearch(
  dbPath: string,
  dataDir: string,
  args: ResearchArgs
): Promise<ResearchPackage> {
  const { task, project, depth = 'thorough', include_sources = true } = args;

  const limits = {
    quick: { sources: 5, quotes: 10 },
    thorough: { sources: 10, quotes: 25 },
    exhaustive: { sources: 20, quotes: 50 },
  };

  const { sources: sourceLimit, quotes: quoteLimit } = limits[depth];

  // Step 1: Search for relevant sources
  const queryVector = await generateEmbedding(task);
  const sources = await searchSources(dbPath, queryVector, {
    limit: sourceLimit,
    project,
  });

  // Step 2: Gather all quotes from found sources
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

  // Step 3: Search for additional relevant quotes
  const chunkResults = await searchChunks(dbPath, queryVector, {
    limit: quoteLimit,
    type: 'quote',
  });

  // Dedupe and merge quotes
  const seenQuotes = new Set(allQuotes.map((q) => q.text));
  for (const chunk of chunkResults) {
    if (!seenQuotes.has(chunk.content)) {
      allQuotes.push({
        id: chunk.id,
        text: chunk.content,
        speaker: chunk.speaker as Quote['speaker'],
        timestamp: chunk.timestamp,
        theme: chunk.theme_name,
        citation: {
          source_id: chunk.source_id,
        },
      });
      seenQuotes.add(chunk.content);
    }
  }

  // Step 4: Find any decisions related to the task
  const decisionChunks = await searchChunks(dbPath, queryVector, {
    limit: 10,
    type: 'decision',
  });

  // Step 5: Synthesize findings
  // TODO: Use Claude Agent SDK to generate a proper synthesis
  const keyFindings = sources.slice(0, 3).map((s) => s.summary);

  const researchPackage: ResearchPackage = {
    query: task,
    project,
    generated_at: new Date().toISOString(),

    // Synthesis (placeholder - Agent SDK would generate this)
    summary: `Research on "${task}" found ${sources.length} relevant sources with ${allQuotes.length} supporting quotes.`,
    key_findings: keyFindings,

    // Evidence
    supporting_quotes: allQuotes.slice(0, quoteLimit),
    related_decisions: decisionChunks.map((d) => ({
      id: d.id,
      decision: d.content,
      rationale: '',
      made_at: '',
      citation: { source_id: d.source_id },
      project_id: project || '',
    })),

    // Sources
    sources_consulted: include_sources
      ? sources.map((s) => ({
          id: s.id,
          title: s.title,
          source_type: s.source_type,
          relevance: s.score,
        }))
      : [],

    // Gaps (placeholder)
    gaps_identified: [],
    suggested_queries: [],
  };

  return researchPackage;
}
