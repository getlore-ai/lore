/**
 * Lore - MCP Tool Definitions
 *
 * Defines the tools exposed by the Lore MCP server.
 * Two categories:
 * 1. Simple tools - Direct database queries, cheap and fast
 * 2. Agentic tools - Use Claude Agent SDK for complex research
 *
 * Descriptions are written for agent consumption. Agents without a skill file
 * should understand Lore purely from these tool descriptions.
 */

import { z } from 'zod';

// Helper to convert Zod schema to JSON Schema
function zodToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  // Simplified conversion - in production use zod-to-json-schema
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape;
    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    for (const [key, value] of Object.entries(shape)) {
      const zodValue = value as z.ZodTypeAny;
      properties[key] = zodToJsonSchema(zodValue);

      if (!(zodValue instanceof z.ZodOptional)) {
        required.push(key);
      }
    }

    return {
      type: 'object',
      properties,
      required: required.length > 0 ? required : undefined,
    };
  }

  if (schema instanceof z.ZodString) {
    return { type: 'string', description: schema.description };
  }

  if (schema instanceof z.ZodNumber) {
    return { type: 'number', description: schema.description };
  }

  if (schema instanceof z.ZodBoolean) {
    return { type: 'boolean', description: schema.description };
  }

  if (schema instanceof z.ZodOptional) {
    return zodToJsonSchema(schema.unwrap());
  }

  if (schema instanceof z.ZodEnum) {
    return { type: 'string', enum: schema.options, description: schema.description };
  }

  if (schema instanceof z.ZodArray) {
    return { type: 'array', items: zodToJsonSchema(schema.element) };
  }

  return { type: 'string' };
}

// ============================================================================
// Simple Query Tools
// ============================================================================

const SearchSchema = z.object({
  query: z.string().describe('Search query'),
  project: z.string().optional().describe('Filter to specific project'),
  source_type: z
    .string()
    .optional()
    .describe('Filter by source type (matches the source_type passed during ingest, e.g. "meeting", "slack", "github-issue")'),
  content_type: z
    .enum(['interview', 'meeting', 'conversation', 'document', 'note', 'analysis'])
    .optional()
    .describe('Filter by content type'),
  limit: z.number().optional().describe('Max results (default 10)'),
  include_archived: z
    .boolean()
    .optional()
    .describe('Include sources from archived projects (default: false)'),
  mode: z
    .enum(['semantic', 'keyword', 'hybrid', 'regex'])
    .optional()
    .describe('Search mode: semantic (vector), keyword (full-text), hybrid (RRF fusion, default), regex (local grep)'),
  since: z
    .string()
    .optional()
    .describe('Only return sources after this date. Accepts ISO dates (2025-06-01), relative shorthand (7d, 2w, 1m), or natural language ("last week", "last month")'),
  before: z
    .string()
    .optional()
    .describe('Only return sources before this date. Same formats as "since"'),
  sort: z
    .enum(['relevance', 'recent'])
    .optional()
    .describe('Sort order: relevance (default) or recent (newest first). Auto-set to recent for temporal queries like "latest" or "most recent"'),
});

const GetSourceSchema = z.object({
  source_id: z.string().describe('ID of the source document'),
  include_content: z.boolean().optional().describe('Include full original content/transcript (default: false - set to true for raw text)'),
});

const ListSourcesSchema = z.object({
  project: z.string().optional().describe('Filter to specific project'),
  source_type: z
    .string()
    .optional()
    .describe('Filter by source type (matches the source_type passed during ingest, e.g. "meeting", "slack", "github-issue")'),
  limit: z.number().optional().describe('Max results (default 20). Pass a high number like 1000 to get all.'),
});

// ============================================================================
// Agentic Research Tool
// ============================================================================

const ResearchSchema = z.object({
  task: z
    .string()
    .describe(
      'Research task description (e.g., "Find all user feedback about export performance")'
    ),
  project: z.string().optional().describe('Focus research on specific project'),
  include_sources: z
    .boolean()
    .optional()
    .describe('Include source document references (default: true)'),
  depth: z
    .enum(['quick', 'standard', 'deep'])
    .optional()
    .describe('Research depth: quick (~30-60s, 3-5 sources), standard (~1-2 min, 5-10 sources, default), deep (~4-8 min, exhaustive)'),
});

// ============================================================================
// Ingest Tool
// ============================================================================

const IngestSchema = z.object({
  content: z.string().describe('The document content to ingest'),
  title: z.string().optional().describe('Title for the document. Auto-generated from content if not provided.'),
  project: z.string().describe('Project this document belongs to'),
  source_type: z
    .string()
    .optional()
    .describe('Content category. Use one of these canonical values: meeting, interview, document, notes, analysis, conversation, article, slack, email, github-issue, github-pr, notion, spec, rfc, transcript, pdf, image, video, audio. Defaults to "document". Variants are auto-normalized (e.g. "Slack Thread" → "slack", "blog post" → "article").'),
  date: z.string().optional().describe('Date of the document (ISO format, defaults to now)'),
  participants: z
    .array(z.string())
    .optional()
    .describe('People involved (for meetings/interviews)'),
  tags: z.array(z.string()).optional().describe('Optional tags for categorization'),
  source_url: z
    .string()
    .optional()
    .describe('Original URL for citation linking (e.g., Slack permalink, Notion page URL, GitHub issue URL). Stored for traceability.'),
  source_name: z
    .string()
    .optional()
    .describe('Human-readable origin label (e.g., "Slack #product-team", "GitHub issue #42", "Notion: Sprint Planning")'),
});

// ============================================================================
// Sync Tool
// ============================================================================

const SyncSchema = z.object({
  git_pull: z
    .boolean()
    .optional()
    .describe('Pull latest changes from git remote (default: true)'),
  git_push: z
    .boolean()
    .optional()
    .describe('Push local changes to git remote (default: true)'),
  index_new: z
    .boolean()
    .optional()
    .describe('Index any new sources found on disk (default: true)'),
  dry_run: z
    .boolean()
    .optional()
    .describe('Show what would be synced without actually processing (default: false)'),
  use_legacy: z
    .boolean()
    .optional()
    .describe('Use only legacy disk-based sync, skip universal sync (default: false)'),
});

// ============================================================================
// Project Management Tools
// ============================================================================

const ArchiveProjectSchema = z.object({
  project: z.string().describe('Name of the project to archive'),
  reason: z
    .string()
    .optional()
    .describe('Reason for archiving (e.g., "Pivoted to new approach", "Project completed")'),
  successor_project: z
    .string()
    .optional()
    .describe('Name of the project that supersedes this one, if any'),
});

// ============================================================================
// Tool Definitions for MCP
// ============================================================================

export const toolDefinitions = [
  // Simple tools
  {
    name: 'search',
    description: `Search the Lore knowledge base. Returns source summaries with relevance scores, matching quotes, and themes.

SEARCH MODES (pick based on your query):
- hybrid (default): Best for most queries. Combines vector similarity + full-text search via RRF fusion.
- semantic: Vector similarity only. Use for conceptual queries ("pain points", "user frustrations") where exact terms don't matter.
- keyword: Full-text search only. Use for exact terms, identifiers, or proper nouns ("TS-01", "OAuth", specific names).
- regex: Pattern matching in local files. Use for code patterns or complex text matching ("OAuth.*config").

WHEN TO USE THIS TOOL:
- Quick lookups of specific information
- Finding sources related to a topic
- Gathering context before answering a question
- Any query where you expect 1-3 relevant sources to answer it

USE 'research' INSTEAD when the question requires cross-referencing multiple sources, detecting patterns across documents, or synthesizing findings with citations. 'research' costs more API calls — avoid it for simple lookups.`,
    inputSchema: zodToJsonSchema(SearchSchema),
  },
  {
    name: 'get_source',
    description: `Retrieve full details of a specific source document by ID. Returns metadata, summary, quotes, themes, and optionally the complete original content.

Set include_content=true to get the full raw text (transcript, document body, etc.). By default only metadata and summary are returned.

USE THIS AFTER 'search' returns a relevant source_id and you need the full document for detailed analysis or quoting.`,
    inputSchema: zodToJsonSchema(GetSourceSchema),
  },
  {
    name: 'list_sources',
    description: `List all sources in the knowledge base, optionally filtered by project or type. Returns summaries sorted by date (newest first).

Use this to browse what exists in a project, understand the scope of available knowledge, or check if content has already been ingested before calling 'ingest'.`,
    inputSchema: zodToJsonSchema(ListSourcesSchema),
  },
  {
    name: 'list_projects',
    description: `List all projects with source counts and latest activity dates. Use this to discover what knowledge domains exist before searching or ingesting content.`,
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  // Agentic tool
  {
    name: 'research',
    description: `Run a comprehensive research query across the knowledge base. An internal agent iteratively searches, reads sources, cross-references findings, and synthesizes a research package with full citations.

ASYNC: This tool returns immediately with a job_id. You MUST then poll 'research_status' with that job_id to get results. Poll every 15-20 seconds. Do NOT assume it is stuck — check the 'activity' array in the status response to see what the agent is doing.

DEPTH CONTROL (optional):
- quick: ~30-60 seconds, finds 3-5 key sources. Good for focused questions.
- standard (default): ~1-2 minutes, 5-10 sources. Good for most queries.
- deep: ~4-8 minutes, exhaustive search. Use for comprehensive audits.

WHEN TO USE:
- Questions that span multiple sources ("What do we know about authentication?")
- Detecting patterns or contradictions across documents
- Building a cited research package for decision-making
- Open-ended exploration of a topic

COST: This tool makes multiple LLM calls internally. For simple lookups, use 'search' instead — it's 10x cheaper and faster.`,
    inputSchema: zodToJsonSchema(ResearchSchema),
  },

  // Research status (polling for async results)
  {
    name: 'research_status',
    description: `Check the status of a running research job. Returns the full research package when complete.

Call this after 'research' returns a job_id. Poll every 15-20 seconds. The response includes an 'activity' array showing exactly what the research agent is doing (searches, sources being read, reasoning). Completion time depends on depth: quick ~30-60s, standard ~1-2 min, deep ~4-8 min. As long as 'total_steps' is increasing, the research is progressing normally — do NOT abandon it.`,
    inputSchema: {
      type: 'object',
      properties: {
        job_id: { type: 'string', description: 'The job_id returned by the research tool' },
      },
      required: ['job_id'],
    },
  },

  // Ingest tool
  {
    name: 'ingest',
    description: `Push content into the Lore knowledge base. This is the primary way to add documents from external systems (Slack threads, Notion pages, GitHub issues, meeting notes, emails, etc.).

IDEMPOTENT: Content is deduplicated by SHA256 hash. Calling ingest with identical content returns {deduplicated: true} immediately — no LLM calls, no disk writes. Safe to call repeatedly.

WHAT HAPPENS:
1. Content hash checked for deduplication
2. Document saved to disk
3. LLM extracts summary, themes, and key quotes (skipped for short content ≤500 chars)
4. Embedding generated for semantic search
5. Indexed in Supabase for instant retrieval

BEST PRACTICES:
- Always pass source_url when available (enables citation linking back to the original)
- Use source_name for human-readable origin context (e.g., "Slack #product-team")
- source_type is a free-form hint — use whatever describes the content (slack, email, notion, github-issue, etc.)
- For short insights, decisions, or notes — just pass the content. Title and source_type are optional.`,
    inputSchema: zodToJsonSchema(IngestSchema),
  },

  // Sync tool
  {
    name: 'sync',
    description: `Sync the knowledge base from configured source directories. Two-phase process:

Phase 1 (Discovery — free, no LLM calls): Scans configured directories, computes content hashes, identifies new files.
Phase 2 (Processing — only new files): Extracts metadata via LLM, generates embeddings, stores in Supabase.

Use this when source directories have been updated externally, or to refresh the index after manual file changes. Source directories are configured via 'lore sync add' CLI command.

Note: For pushing content from agents, use 'ingest' instead — it's the direct path.`,
    inputSchema: zodToJsonSchema(SyncSchema),
  },

  // Project management
  {
    name: 'archive_project',
    description: `Archive a project and exclude its sources from default search results. Archived sources are preserved for historical reference and can be included with include_archived=true in search.

Only use when explicitly requested — this is a curation action, not an automatic cleanup.`,
    inputSchema: zodToJsonSchema(ArchiveProjectSchema),
  },
];
