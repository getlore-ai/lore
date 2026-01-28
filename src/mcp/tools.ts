/**
 * Lore - MCP Tool Definitions
 *
 * Defines the tools exposed by the Lore MCP server.
 * Two categories:
 * 1. Simple tools - Direct database queries, cheap and fast
 * 2. Agentic tools - Use Claude Agent SDK for complex research
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
  query: z.string().describe('Semantic search query'),
  project: z.string().optional().describe('Filter to specific project'),
  source_type: z
    .enum(['granola', 'claude-code', 'claude-desktop', 'chatgpt', 'markdown', 'document'])
    .optional()
    .describe('Filter by source type'),
  content_type: z
    .enum(['interview', 'meeting', 'conversation', 'document', 'note', 'analysis'])
    .optional()
    .describe('Filter by content type'),
  limit: z.number().optional().describe('Max results (default 10)'),
  include_archived: z
    .boolean()
    .optional()
    .describe('Include sources from archived projects (default: false)'),
});

const GetSourceSchema = z.object({
  source_id: z.string().describe('ID of the source document'),
  include_content: z.boolean().optional().describe('Include full original content'),
});

const ListSourcesSchema = z.object({
  project: z.string().optional().describe('Filter to specific project'),
  source_type: z
    .enum(['granola', 'claude-code', 'claude-desktop', 'chatgpt', 'markdown', 'document'])
    .optional()
    .describe('Filter by source type'),
  limit: z.number().optional().describe('Max results (default 20)'),
});

const RetainSchema = z.object({
  content: z.string().describe('The insight, decision, or note to retain'),
  project: z.string().describe('Project this belongs to'),
  type: z
    .enum(['insight', 'decision', 'requirement', 'note'])
    .describe('Type of knowledge being retained'),
  source_context: z
    .string()
    .optional()
    .describe('Where this came from (e.g., "user interview with Sarah")'),
  tags: z.array(z.string()).optional().describe('Optional tags for categorization'),
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
});

// ============================================================================
// Ingest Tool
// ============================================================================

const IngestSchema = z.object({
  content: z.string().describe('The document content to ingest'),
  title: z.string().describe('Title for the document'),
  project: z.string().describe('Project this document belongs to'),
  source_type: z
    .enum(['meeting', 'interview', 'document', 'notes', 'analysis', 'conversation'])
    .optional()
    .describe('Type of source (default: document)'),
  date: z.string().optional().describe('Date of the document (ISO format, defaults to now)'),
  participants: z
    .array(z.string())
    .optional()
    .describe('People involved (for meetings/interviews)'),
  tags: z.array(z.string()).optional().describe('Optional tags for categorization'),
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
    description:
      'Semantic search across all sources in the knowledge repository. Returns summaries with relevant quotes and themes. Use this for quick lookups.',
    inputSchema: zodToJsonSchema(SearchSchema),
  },
  {
    name: 'get_source',
    description:
      'Get full details of a specific source document including all quotes, themes, and optionally the complete original content. Use for deep-diving into a specific source.',
    inputSchema: zodToJsonSchema(GetSourceSchema),
  },
  {
    name: 'list_sources',
    description:
      'List all sources in the repository, optionally filtered by project or type. Returns summaries sorted by date.',
    inputSchema: zodToJsonSchema(ListSourcesSchema),
  },
  {
    name: 'list_projects',
    description:
      'List all projects with their source counts and latest activity. Use to understand what knowledge exists.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'retain',
    description:
      'Save an insight, decision, requirement, or note to the knowledge repository. Use this to explicitly capture important learnings from conversations.',
    inputSchema: zodToJsonSchema(RetainSchema),
  },

  // Agentic tool
  {
    name: 'research',
    description:
      'Comprehensive research across the knowledge repository. Uses an internal agent to search, cross-reference, and synthesize findings into a research package with citations. More thorough than simple search but takes longer. Use for complex questions that need multiple sources.',
    inputSchema: zodToJsonSchema(ResearchSchema),
  },

  // Ingest tool
  {
    name: 'ingest',
    description:
      'Ingest a document directly into the knowledge repository. Use this when you have document content (meeting notes, interview transcript, analysis, etc.) that should be added to Lore. The document will be saved, indexed, and immediately searchable.',
    inputSchema: zodToJsonSchema(IngestSchema),
  },

  // Sync tool
  {
    name: 'sync',
    description:
      'Sync the knowledge repository with the latest sources. Optionally pulls from git remote and indexes any new sources found on disk. Use this to refresh the knowledge base when you know new content has been added.',
    inputSchema: zodToJsonSchema(SyncSchema),
  },

  // Project management
  {
    name: 'archive_project',
    description:
      'Archive a project and all its sources. Archived projects are excluded from search by default but preserved for historical reference. Use when a project is completed, abandoned, or superseded by a new approach. This is a human-triggered curation action.',
    inputSchema: zodToJsonSchema(ArchiveProjectSchema),
  },
];
