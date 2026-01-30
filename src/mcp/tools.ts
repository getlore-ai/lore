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
  include_content: z.boolean().optional().describe('Include full original content/transcript (default: false - set to true for raw text)'),
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
    description: `Semantic search across all sources in the knowledge repository. Returns summaries with relevant quotes and themes. Use this for quick lookups.

USE THIS WHEN:
- Looking up specific known information
- Single-topic queries with expected direct answers
- Quick context gathering before a conversation
- You know roughly what you're looking for

USE 'research' INSTEAD WHEN:
- Question requires cross-referencing multiple sources
- Need synthesis or pattern detection across sources
- Looking for conflicts or evolution of thinking over time
- Building a comprehensive research package
- Query is open-ended like "what do we know about X"`,
    inputSchema: zodToJsonSchema(SearchSchema),
  },
  {
    name: 'get_source',
    description: `Get full details of a specific source document including all quotes, themes, and optionally the complete original content. Use for deep-diving into a specific source.

IMPORTANT: Set include_content=true to get the full raw transcript/document text. By default only metadata and summary are returned.

USE THIS WHEN:
- You have a source_id from search results and need full content
- Deep-diving into a specific document
- Need the complete original text for detailed analysis

USE 'search' FIRST when you don't have a source_id yet.`,
    inputSchema: zodToJsonSchema(GetSourceSchema),
  },
  {
    name: 'list_sources',
    description: `List all sources in the repository, optionally filtered by project or type. Returns summaries sorted by date.

USE THIS WHEN:
- Browsing what exists in a project
- Need to see all sources chronologically
- Understanding the scope of available knowledge

USE 'search' INSTEAD when you have a specific query in mind.`,
    inputSchema: zodToJsonSchema(ListSourcesSchema),
  },
  {
    name: 'list_projects',
    description: `List all projects with their source counts and latest activity.

USE THIS WHEN:
- Starting a conversation to understand what knowledge exists
- User asks "what projects do you know about"
- Need to validate a project name before searching`,
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'retain',
    description: `Save an insight, decision, requirement, or note to the knowledge repository. Use this to explicitly capture important learnings from conversations.

USE THIS WHEN:
- User explicitly asks to save/remember something
- A key decision is made that should be preserved
- Capturing an insight that emerged from discussion
- User says "remember this" or "save this for later"

DO NOT USE for raw meeting notes or documents - use 'ingest' instead.`,
    inputSchema: zodToJsonSchema(RetainSchema),
  },

  // Agentic tool
  {
    name: 'research',
    description: `Comprehensive research across the knowledge repository. Uses an internal agent to search, cross-reference, and synthesize findings into a research package with citations. More thorough than simple search but takes longer. Use for complex questions that need multiple sources.

USE THIS WHEN:
- Question spans multiple sources or needs synthesis
- Looking for patterns, conflicts, or evolution of thinking
- Need a research package with citations for delegation
- Open-ended queries like "what do we know about X"
- User explicitly asks for "research" or "comprehensive analysis"
- Need to detect contradictions between sources

USE 'search' INSTEAD WHEN:
- Simple lookup of specific known information
- Quick context gathering
- You expect a single source to answer the question

COST: Slower and uses more API calls than simple search. Don't use for simple lookups.`,
    inputSchema: zodToJsonSchema(ResearchSchema),
  },

  // Ingest tool
  {
    name: 'ingest',
    description: `Ingest a document directly into the knowledge repository. Use this when you have document content (meeting notes, interview transcript, analysis, etc.) that should be added to Lore. The document will be saved, indexed, and immediately searchable.

USE THIS WHEN:
- User shares meeting notes, interview transcripts, or documents
- Adding analysis or summaries to the knowledge base
- User says "add this to lore" or "save this document"

USE 'retain' INSTEAD for saving discrete insights, decisions, or notes (not full documents).`,
    inputSchema: zodToJsonSchema(IngestSchema),
  },

  // Sync tool
  {
    name: 'sync',
    description: `Sync the knowledge repository using a two-phase approach:

PHASE 1 - Discovery (free, no LLM calls):
- Scans all configured source directories
- Computes content hashes for deduplication
- Checks which files already exist in Supabase

PHASE 2 - Processing (only for NEW files):
- Claude extracts metadata (title, summary, date, content_type)
- Generates embeddings for semantic search
- Stores in Supabase and local data directory

Configure source directories with 'lore sources add' CLI command.

USE THIS WHEN:
- User says content was added externally
- Starting a session and want fresh data
- After adding new files to watched directories
- User asks to "sync", "update", or "refresh" the knowledge base`,
    inputSchema: zodToJsonSchema(SyncSchema),
  },

  // Project management
  {
    name: 'archive_project',
    description: `Archive a project and all its sources. Archived projects are excluded from search by default but preserved for historical reference. Use when a project is completed, abandoned, or superseded by a new approach. This is a human-triggered curation action.

USE THIS WHEN:
- User explicitly asks to archive a project
- Project is completed or abandoned
- Project was superseded by a new approach

NEVER archive without explicit user request - this is a curation action.`,
    inputSchema: zodToJsonSchema(ArchiveProjectSchema),
  },
];
