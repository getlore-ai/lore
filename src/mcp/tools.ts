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
  include_logs: z
    .boolean()
    .optional()
    .describe('Include log entries from the log tool (default: false)'),
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
// Project Brief Tools
// ============================================================================

const GetBriefSchema = z.object({
  project: z.string().describe('Project name'),
  include_history: z
    .boolean()
    .optional()
    .describe('Include version history metadata (default: false)'),
});

// ============================================================================
// Log Tool (lightweight log entries)
// ============================================================================

const LogSchema = z.object({
  action: z
    .enum(['add', 'update', 'delete'])
    .describe('Action to perform (default: add)')
    .optional(),
  message: z
    .string()
    .describe('Log message content. Required for add and update; ignored for delete.')
    .optional(),
  project: z
    .string()
    .describe('Project this relates to (required for add)')
    .optional(),
  id: z
    .string()
    .describe('Source ID of the log entry (required for update and delete)')
    .optional(),
});

// ============================================================================
// Tool Definitions for MCP
// ============================================================================

export const toolDefinitions = [
  {
    name: 'search',
    description: `Search the knowledge base. Returns source summaries with relevance scores, quotes, and themes. Supports date filtering via since/before and sort by relevance or recency. Use 'research' instead for questions requiring cross-referencing across many sources.`,
    inputSchema: zodToJsonSchema(SearchSchema),
  },
  {
    name: 'get_source',
    description: `Get full details of a source document by ID. Set include_content=true for the complete original text.`,
    inputSchema: zodToJsonSchema(GetSourceSchema),
  },
  {
    name: 'list_sources',
    description: `List sources, optionally filtered by project or type. Sorted by date (newest first).`,
    inputSchema: zodToJsonSchema(ListSourcesSchema),
  },
  {
    name: 'list_projects',
    description: `List all projects with source counts and latest activity dates.`,
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_brief',
    description: `Get the project brief — a synthesis of all knowledge in a project with current state, key evidence, open questions, and trajectory. Start here for project context. Reports staleness when new sources exist since last generation.`,
    inputSchema: zodToJsonSchema(GetBriefSchema),
  },
  {
    name: 'research',
    description: `Async research across the knowledge base. An agent iteratively searches, reads sources, cross-references, and synthesizes findings with citations. Returns a job_id — poll research_status for results. Depth: quick (~30-60s), standard (~1-2min, default), deep (~4-8min).`,
    inputSchema: zodToJsonSchema(ResearchSchema),
  },
  {
    name: 'research_status',
    description: `Poll for research job results. Long-polls up to 20s. Check 'activity' array to see agent progress.`,
    inputSchema: {
      type: 'object',
      properties: {
        job_id: { type: 'string', description: 'The job_id from research' },
      },
      required: ['job_id'],
    },
  },
  {
    name: 'ingest',
    description: `Add content to the knowledge base. Idempotent (SHA256 dedup). Pass source_url and source_name when available for citation linking. Title and source_type are optional.`,
    inputSchema: zodToJsonSchema(IngestSchema),
  },
  {
    name: 'log',
    description: `Manage project log entries — progress updates, decisions, and status notes. Actions: add (default, requires message + project), update (requires id + message, preserves timestamp), delete (requires id). Log entries are searchable and included in briefs, but hidden from list_sources by default.`,
    inputSchema: zodToJsonSchema(LogSchema),
  },
];
