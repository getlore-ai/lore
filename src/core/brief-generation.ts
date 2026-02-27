/**
 * Brief - Generation
 *
 * Full and incremental brief generation using Claude.
 */

import Anthropic from '@anthropic-ai/sdk';

import {
  getAllSources,
  getSourceContentSizes,
  getSourceContentMap,
} from './vector-store.js';
import type {
  BriefEvidence,
  ProjectBrief,
  SourceInfo,
} from './brief-types.js';
import { CONTENT_BUDGET_BYTES, MAX_SOURCES_ABSOLUTE } from './brief-types.js';
import { getLatestBrief, saveBrief } from './brief-storage.js';

// ============================================================================
// Public API
// ============================================================================

/**
 * Generate a project brief by synthesizing source documents.
 *
 * Two modes, auto-detected:
 * - **Full generation** (first brief): reads full content of all sources
 * - **Incremental update** (brief exists): previous brief + summaries of old sources + full content of new sources
 *
 * Large projects are chunked across multiple Claude calls to stay within context limits.
 */
export async function generateBrief(
  dbPath: string,
  dataDir: string,
  project: string,
  options: { focus?: string; full?: boolean; onProgress?: (message: string) => void } = {}
): Promise<ProjectBrief> {
  const { onProgress } = options;
  const focus = options.focus?.slice(0, 200).replace(/[\x00-\x1f]/g, '') || undefined;

  onProgress?.('Fetching sources...');

  // Get all sources for this project (metadata + summaries)
  const allSources = await getAllSources(dbPath, {
    project,
    sort_by: 'created_at',
  });

  if (allSources.length === 0) {
    throw new Error(`No sources found for project "${project}"`);
  }

  // Cap to most recent MAX_SOURCES_ABSOLUTE (chronological, newest last)
  const sources = [...allSources].reverse().slice(-MAX_SOURCES_ABSOLUTE);
  if (sources.length < allSources.length) {
    onProgress?.(`Capped to ${MAX_SOURCES_ABSOLUTE} most recent sources (${allSources.length} total)`);
  }

  const existingBrief = await getLatestBrief(dbPath, project);

  // Dispatch: full generation or incremental update
  let brief: ProjectBrief;
  if (!existingBrief || options.full) {
    onProgress?.(`Full generation from ${sources.length} sources...`);
    brief = await generateFullBrief(dbPath, sources, project, existingBrief, focus, onProgress);
  } else {
    brief = await generateIncrementalBrief(dbPath, sources, project, existingBrief, focus, onProgress);
  }

  // Save to Supabase and disk
  onProgress?.('Saving brief...');
  const { conflict } = await saveBrief(dbPath, dataDir, brief);

  if (conflict) {
    const winner = await getLatestBrief(dbPath, project);
    return winner ?? brief;
  }

  return brief;
}

// ============================================================================
// Full Generation (first brief or --full flag)
// ============================================================================

async function generateFullBrief(
  dbPath: string,
  sources: SourceInfo[],
  project: string,
  existingBrief: ProjectBrief | null,
  focus: string | undefined,
  onProgress?: (message: string) => void
): Promise<ProjectBrief> {
  // Get content sizes to decide strategy
  const contentSizes = await getSourceContentSizes(dbPath, { project });
  const sourceIds = sources.map((s) => s.id);
  const totalContentBytes = sourceIds.reduce((sum, id) => sum + (contentSizes.get(id) || 0), 0);

  onProgress?.(`Total content: ${Math.round(totalContentBytes / 1024)}KB across ${sources.length} sources`);

  const idsWithContent = sourceIds.filter((id) => contentSizes.has(id));
  const nextVersion = existingBrief ? existingBrief.version + 1 : 1;

  if (totalContentBytes <= CONTENT_BUDGET_BYTES) {
    // Single-call path: everything fits — fetch all content
    onProgress?.('Single-call synthesis (content fits in budget)...');
    const contentMap = await getSourceContentMap(dbPath, idsWithContent);
    const sourceContext = buildSourceContext(sources, contentMap);
    const previousBriefContext = existingBrief ? formatPreviousBrief(existingBrief, sources.length) : '';

    const parsed = await buildStructuredBrief(
      project,
      sourceContext,
      sources.length,
      previousBriefContext,
      existingBrief !== null,
      focus
    );

    return {
      project,
      version: nextVersion,
      generated_at: new Date().toISOString(),
      current_state: parsed.current_state,
      key_evidence: parsed.key_evidence || [],
      open_questions: parsed.open_questions || [],
      trajectory: parsed.trajectory,
      recent_changes: parsed.recent_changes || null,
      source_count_at_generation: sources.length,
      focus: focus || undefined,
    };
  }

  // Multi-chunk path: process in sequential chunks
  onProgress?.(`Content exceeds budget — chunking across multiple calls...`);
  const chunks = partitionIntoBudget(sources, contentSizes);
  onProgress?.(`Split into ${chunks.length} chunks`);

  let priorSynthesis = '';
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const isLast = i === chunks.length - 1;
    const chunkContentMap = await getSourceContentMap(
      dbPath,
      chunk.map((s) => s.id).filter((id) => contentSizes.has(id))
    );
    const chunkContext = buildSourceContext(chunk, chunkContentMap);

    if (isLast) {
      // Final chunk: produce structured JSON
      onProgress?.(`Chunk ${i + 1}/${chunks.length} (final) — producing structured brief...`);
      const previousBriefContext = existingBrief ? formatPreviousBrief(existingBrief, sources.length) : '';
      const parsed = await buildStructuredBrief(
        project,
        chunkContext,
        sources.length,
        previousBriefContext,
        existingBrief !== null,
        focus,
        priorSynthesis
      );

      return {
        project,
        version: nextVersion,
        generated_at: new Date().toISOString(),
        current_state: parsed.current_state,
        key_evidence: parsed.key_evidence || [],
        open_questions: parsed.open_questions || [],
        trajectory: parsed.trajectory,
        recent_changes: parsed.recent_changes || null,
        source_count_at_generation: sources.length,
        focus: focus || undefined,
      };
    } else {
      // Intermediate chunk: produce free-form narrative
      onProgress?.(`Chunk ${i + 1}/${chunks.length} — synthesizing...`);
      priorSynthesis = await synthesizeChunk(project, chunkContext, priorSynthesis, focus);
    }
  }

  // Should not reach here, but TypeScript needs a return
  throw new Error('Unexpected: no chunks to process');
}

// ============================================================================
// Incremental Update (brief already exists)
// ============================================================================

async function generateIncrementalBrief(
  dbPath: string,
  sources: SourceInfo[],
  project: string,
  existingBrief: ProjectBrief,
  focus: string | undefined,
  onProgress?: (message: string) => void
): Promise<ProjectBrief> {
  const briefGeneratedAt = new Date(existingBrief.generated_at);

  // Split by indexed_at (when ingested), not created_at (content date).
  // A document ingested today may have an old created_at if it records a past event.
  const oldSources = sources.filter((s) => new Date(s.indexed_at) <= briefGeneratedAt);
  const newSources = sources.filter((s) => new Date(s.indexed_at) > briefGeneratedAt);

  onProgress?.(`Incremental update: ${oldSources.length} existing + ${newSources.length} new sources`);

  if (newSources.length === 0) {
    // No new sources — shouldn't normally happen, but produce a minimal update
    onProgress?.('No new sources since last brief — refreshing synthesis...');
  }

  // Get content sizes for new sources to check if incremental is feasible
  const contentSizes = await getSourceContentSizes(dbPath, { project });
  const newContentBytes = newSources.reduce((sum, s) => sum + (contentSizes.get(s.id) || 0), 0);

  if (newContentBytes > CONTENT_BUDGET_BYTES) {
    // New content alone exceeds budget — fall back to full generation
    onProgress?.(`New content (${Math.round(newContentBytes / 1024)}KB) exceeds budget — falling back to full generation...`);
    return generateFullBrief(dbPath, sources, project, existingBrief, focus, onProgress);
  }

  // Fetch full content for new sources only
  const newIds = newSources.map((s) => s.id).filter((id) => contentSizes.has(id));
  const newContentMap = await getSourceContentMap(dbPath, newIds);

  // Build the prompt sections
  const previousBriefFormatted = formatPreviousBrief(existingBrief, sources.length);
  const oldSummaryContext = buildSummaryContext(oldSources);
  const newSourceContext = newSources.length > 0
    ? buildSourceContext(newSources, newContentMap)
    : '(No new sources since last brief)';

  const nextVersion = existingBrief.version + 1;

  const focusInstruction = focus
    ? `\n\nFOCUS AREA: Pay special attention to "${focus}" when synthesizing.`
    : '';

  const systemPrompt = `You are a project analyst performing an incremental update to a living project brief.

You have:
1. The previous brief (comprehensive synthesis of all prior knowledge)
2. Summaries of ALL existing sources (for drift cross-checking)
3. Full content of NEW sources added since the last brief

Your job is to integrate the new findings while maintaining accuracy against all known sources.${focusInstruction}

ATTRIBUTION RULES:
- Name specific people: "Sarah proposed X" not "the team discussed X"
- Include EXACT quotes from source content as evidence (copy verbatim, don't paraphrase)
- Reference specific documents by title and date
- When new evidence contradicts old: explain the evolution ("Previously X (Jan 5), updated to Y (Feb 10)")
- Preserve strong existing evidence, replace weaker items with better-grounded new evidence`;

  const userPrompt = `Project: "${project}"

${previousBriefFormatted}

## All Existing Source Summaries (for drift cross-check)
${oldSummaryContext}

## New Sources (full content — added since last brief)
${newSourceContext}

Produce an updated project brief as JSON with this exact structure:
{
  "current_state": "2-3 paragraphs synthesizing the CURRENT state, integrating new findings",
  "key_evidence": [
    {
      "claim": "A specific finding — name the person, document, or meeting",
      "source_id": "the source's id field",
      "source_title": "the source's title",
      "quote": "EXACT quote from the source content (verbatim, not paraphrased)",
      "date": "the source's date"
    }
  ],
  "open_questions": ["Unresolved question or knowledge gap 1", "..."],
  "trajectory": "1-2 paragraphs on project evolution, noting how new sources shift understanding",
  "recent_changes": "What changed since the previous brief — new sources, shifted understanding, resolved questions"
}

Return 8-15 key_evidence items — blend the best existing evidence with new findings.
Quotes MUST be exact text from the source content, not summaries or paraphrases.
Include 3-5 open_questions.
Respond with ONLY the JSON object.`;

  const parsed = await callClaude(systemPrompt, userPrompt);

  return {
    project,
    version: nextVersion,
    generated_at: new Date().toISOString(),
    current_state: parsed.current_state,
    key_evidence: parsed.key_evidence || [],
    open_questions: parsed.open_questions || [],
    trajectory: parsed.trajectory,
    recent_changes: parsed.recent_changes || null,
    source_count_at_generation: sources.length,
    focus: focus || undefined,
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

/** Format a source with full content (falling back to summary if content unavailable). */
function buildSourceContext(sources: SourceInfo[], contentMap: Map<string, string>): string {
  return sources
    .map((s, i) => {
      const date = formatDate(s.created_at);
      const content = contentMap.get(s.id);
      if (content) {
        return `[${i + 1}] ID: ${s.id}\n"${s.title}" (${s.source_type}, ${date})\n\n${content}`;
      }
      // Fallback to summary when content isn't stored
      return `[${i + 1}] ID: ${s.id}\n"${s.title}" (${s.source_type}, ${date})\nSummary: ${s.summary}`;
    })
    .join('\n\n---\n\n');
}

/** Format sources with summaries only (for old sources in incremental mode). */
function buildSummaryContext(sources: SourceInfo[]): string {
  return sources
    .map((s, i) => {
      const date = formatDate(s.created_at);
      return `[${i + 1}] ID: ${s.id} — "${s.title}" (${s.source_type}, ${date})\n   ${s.summary}`;
    })
    .join('\n\n');
}

/** Format an existing brief for inclusion in prompts. */
function formatPreviousBrief(brief: ProjectBrief, currentSourceCount: number): string {
  const evidenceSummary = brief.key_evidence
    .map((e) => `- ${e.claim} [${e.source_title}, ${e.date}]${e.quote ? ` — "${e.quote}"` : ''}`)
    .join('\n');

  return `## Previous Brief (v${brief.version}, generated ${brief.generated_at})

### Current State
${brief.current_state}

### Key Evidence
${evidenceSummary}

### Trajectory
${brief.trajectory}

### Open Questions
${brief.open_questions.map((q) => `- ${q}`).join('\n')}

Sources at last generation: ${brief.source_count_at_generation}
Sources now: ${currentSourceCount}`;
}

/** Partition sources into chunks that fit within the content budget. */
function partitionIntoBudget(
  sources: SourceInfo[],
  contentSizes: Map<string, number>
): SourceInfo[][] {
  const chunks: SourceInfo[][] = [];
  let currentChunk: SourceInfo[] = [];
  let currentBytes = 0;

  for (const source of sources) {
    const size = contentSizes.get(source.id) || Buffer.byteLength(source.summary, 'utf-8');
    if (currentChunk.length > 0 && currentBytes + size > CONTENT_BUDGET_BYTES) {
      chunks.push(currentChunk);
      currentChunk = [];
      currentBytes = 0;
    }
    currentChunk.push(source);
    currentBytes += size;
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }

  return chunks;
}

/** Intermediate chunk synthesis — produces free-form narrative for chaining. */
async function synthesizeChunk(
  project: string,
  sourceContext: string,
  priorSynthesis: string,
  focus?: string
): Promise<string> {
  const focusInstruction = focus
    ? `\nFOCUS AREA: Pay special attention to "${focus}".`
    : '';

  const systemPrompt = `You are synthesizing a batch of source documents for project "${project}".
Produce a comprehensive narrative summary that preserves:
- Specific names of people and what they said or decided
- Direct quotes (verbatim from the sources)
- Dates, numbers, and concrete details
- Contradictions or evolution of thinking over time${focusInstruction}

This is an intermediate synthesis — another pass will refine it into a structured brief.
Be thorough rather than concise. Preserve attribution.`;

  const userPrompt = priorSynthesis
    ? `## Prior Synthesis (from earlier source batches)\n${priorSynthesis}\n\n## New Sources\n${sourceContext}\n\nIntegrate these new sources into the synthesis. Preserve all important details from both the prior synthesis and the new sources.`
    : `## Sources\n${sourceContext}\n\nSynthesize these sources into a comprehensive narrative.`;

  const parsed = await callClaudeRaw(systemPrompt, userPrompt);
  return parsed;
}

/** Final Claude call that produces the structured ProjectBrief JSON. */
async function buildStructuredBrief(
  project: string,
  sourceContext: string,
  totalSourceCount: number,
  previousBriefContext: string,
  hasExistingBrief: boolean,
  focus?: string,
  priorSynthesis?: string
): Promise<{
  current_state: string;
  key_evidence: BriefEvidence[];
  open_questions: string[];
  trajectory: string;
  recent_changes: string | null;
}> {
  const focusInstruction = focus
    ? `\n\nFOCUS AREA: Pay special attention to "${focus}" when synthesizing.`
    : '';

  const systemPrompt = `You are a project analyst synthesizing a living project brief from source documents.
Your job is to produce a structured, evidence-grounded synthesis of everything known about this project.${focusInstruction}

ATTRIBUTION RULES — these are critical:
- Name specific people: "Sarah proposed X" not "the team discussed X"
- The "quote" field MUST contain EXACT text copied verbatim from the source content — not paraphrases or summaries
- Reference specific documents by title and date in your narrative
- When sources contradict each other, note the evolution: "Previously X (Jan 5), updated to Y (Feb 10)"
- Write for someone who needs to quickly understand this project with full confidence in the evidence`;

  let userContent = `Project: "${project}"
Sources (${totalSourceCount} total, chronological order — newest last):

${sourceContext}`;

  if (priorSynthesis) {
    userContent += `\n\n## Synthesis from Earlier Source Batches\n${priorSynthesis}`;
  }

  if (previousBriefContext) {
    userContent += `\n\n${previousBriefContext}`;
  }

  userContent += `

Produce a project brief as JSON with this exact structure:
{
  "current_state": "2-3 paragraphs synthesizing the current state of the project. What is it? Where is it now? What's the latest understanding?",
  "key_evidence": [
    {
      "claim": "A specific finding — name the person, document, or meeting",
      "source_id": "the source's id field",
      "source_title": "the source's title",
      "quote": "EXACT quote from the source content (verbatim, not paraphrased)",
      "date": "the source's date"
    }
  ],
  "open_questions": ["Unresolved question or knowledge gap 1", "..."],
  "trajectory": "1-2 paragraphs on how the project has evolved over time and where it appears to be heading",
  "recent_changes": ${hasExistingBrief ? '"What changed since the previous brief — new sources, shifted understanding, resolved questions"' : 'null'}
}

Return 8-15 key_evidence items, prioritizing the most important and recent.
Quotes MUST be exact text from the source content, not summaries or paraphrases.
Include 3-5 open_questions.
Respond with ONLY the JSON object.`;

  return await callClaude(systemPrompt, userContent);
}

// ============================================================================
// Claude API Helpers
// ============================================================================

/** Call Claude and parse the response as structured brief JSON. */
async function callClaude(
  systemPrompt: string,
  userPrompt: string
): Promise<{
  current_state: string;
  key_evidence: BriefEvidence[];
  open_questions: string[];
  trajectory: string;
  recent_changes: string | null;
}> {
  const raw = await callClaudeRaw(systemPrompt, userPrompt);

  // Parse JSON from response (handle optional markdown fences)
  let jsonStr = raw.trim();
  const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenceMatch) {
    jsonStr = fenceMatch[1];
  }

  try {
    return JSON.parse(jsonStr) as {
      current_state: string;
      key_evidence: BriefEvidence[];
      open_questions: string[];
      trajectory: string;
      recent_changes: string | null;
    };
  } catch (e) {
    const preview = jsonStr.slice(0, 500);
    throw new Error(`Failed to parse brief JSON from Claude response: ${(e as Error).message}\nResponse preview: ${preview}`);
  }
}

/** Call Claude and return raw text response. */
async function callClaudeRaw(systemPrompt: string, userPrompt: string): Promise<string> {
  const anthropic = new Anthropic();
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 8192,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
    temperature: 0.3,
  });

  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('No text response from Claude');
  }

  return textBlock.text;
}

function formatDate(isoDate: string): string {
  return new Date(isoDate).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}
