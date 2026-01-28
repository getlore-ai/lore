/**
 * Lore - Core Types
 *
 * A three-layer knowledge architecture:
 * 1. Source Documents - Immutable original content (interviews, transcripts, docs)
 * 2. Extracted Insights - Quotes, themes, decisions with links back to sources
 * 3. Working Memory - Synthesized context for agent consumption
 */

// ============================================================================
// Source Types - Where knowledge comes from
// ============================================================================

export type SourceType =
  | 'granola'        // Meeting transcripts from Granola app
  | 'claude-code'    // Claude Code conversation exports
  | 'claude-desktop' // Claude Desktop exports
  | 'chatgpt'        // ChatGPT conversation exports
  | 'markdown'       // Markdown documents/notes
  | 'document';      // Other documents (PDFs, etc.)

export type ContentType =
  | 'interview'      // User interview/research call
  | 'meeting'        // General meeting
  | 'conversation'   // AI conversation (Claude, ChatGPT)
  | 'document'       // Written document
  | 'note'           // Quick note/memo
  | 'analysis';      // Competitor analysis, research synthesis

// ============================================================================
// Source Document - The immutable original
// ============================================================================

export interface SourceDocument {
  id: string;

  // Origin
  source_type: SourceType;
  source_id: string;              // Original ID in source system
  source_path?: string;           // Path to original file if applicable

  // Content
  title: string;
  content: string;                // Full original content
  content_type: ContentType;

  // Metadata
  created_at: string;             // ISO date
  imported_at: string;            // When added to Lore
  participants?: string[];        // People involved (for meetings/interviews)

  // Project association
  projects: string[];             // Project IDs this relates to
  tags: string[];                 // User-defined tags
}

// ============================================================================
// Extracted Insights - Structured knowledge with provenance
// ============================================================================

export interface Citation {
  source_id: string;              // Reference to SourceDocument
  location?: string;              // Timestamp, line number, section
  context?: string;               // Surrounding context
}

export interface Quote {
  id: string;
  text: string;
  speaker?: 'user' | 'participant' | 'ai' | 'unknown';
  speaker_name?: string;
  timestamp?: string;
  theme?: string;
  citation: Citation;
}

export interface Theme {
  name: string;
  evidence: Quote[];
  summary?: string;
}

export type ThemeName =
  | 'pain-points'       // User frustrations, problems
  | 'feature-requests'  // Desired features, wishlist
  | 'positive-feedback' // What users liked
  | 'pricing'           // Cost concerns, value perception
  | 'competition'       // Competitor mentions
  | 'workflow'          // How users currently work
  | 'decisions'         // Key decisions made
  | 'requirements'      // Product/technical requirements
  | 'insights';         // General insights

export interface Decision {
  id: string;
  decision: string;
  rationale: string;
  alternatives_considered?: string[];
  made_at: string;
  citation: Citation;
  project_id: string;
}

export interface Requirement {
  id: string;
  description: string;
  priority: 'must' | 'should' | 'could' | 'wont';
  source_quotes: Quote[];
  project_id: string;
}

// ============================================================================
// Project & Lineage - Organizing knowledge
// ============================================================================

export type ProjectStatus = 'active' | 'paused' | 'completed' | 'archived';

export interface Project {
  id: string;
  name: string;
  description: string;
  status: ProjectStatus;
  created_at: string;
  updated_at: string;

  // Hierarchy
  parent_id?: string;             // Parent project for sub-projects

  // Summary stats (computed)
  source_count?: number;
  quote_count?: number;
  decision_count?: number;
}

export type LineageEventType =
  | 'created'     // Project started
  | 'decision'    // Key decision made
  | 'pivot'       // Direction change
  | 'milestone'   // Achievement reached
  | 'insight'     // Important learning
  | 'delegation'; // Work handed to agent

export interface LineageEvent {
  id: string;
  project_id: string;
  event_type: LineageEventType;
  title: string;
  description: string;
  timestamp: string;
  source_ids: string[];           // Related source documents
}

// ============================================================================
// Indexed Records - What goes in the vector store
// ============================================================================

export interface SourceRecord {
  id: string;
  title: string;
  source_type: SourceType;
  content_type: ContentType;
  projects: string;               // JSON stringified
  tags: string;                   // JSON stringified
  created_at: string;
  summary: string;                // LLM-generated summary
  themes_json: string;            // JSON stringified Theme[]
  quotes_json: string;            // JSON stringified Quote[]
  has_full_content: boolean;
  vector: number[];
}

export interface ChunkRecord {
  id: string;
  source_id: string;
  content: string;
  type: 'quote' | 'theme' | 'summary' | 'decision' | 'requirement';
  theme_name?: string;
  speaker?: string;
  timestamp?: string;
  vector: number[];
}

// ============================================================================
// Search & Query Results
// ============================================================================

export interface SearchResult {
  source_id: string;
  title: string;
  source_type: SourceType;
  content_type: ContentType;
  projects: string[];
  summary: string;
  relevance_score: number;
  matching_quotes: Quote[];
  matching_themes: string[];
}

export interface ResearchPackage {
  query: string;
  project?: string;
  generated_at: string;

  // Synthesized findings
  summary: string;
  key_findings: string[];

  // Evidence with citations
  supporting_quotes: Quote[];
  related_decisions: Decision[];

  // Sources used
  sources_consulted: Array<{
    id: string;
    title: string;
    source_type: SourceType;
    relevance: number;
  }>;

  // Follow-up suggestions
  gaps_identified?: string[];
  suggested_queries?: string[];
}

// ============================================================================
// MCP Tool Arguments
// ============================================================================

export interface SearchArgs {
  query: string;
  project?: string;
  source_type?: SourceType;
  content_type?: ContentType;
  limit?: number;
}

export interface RetainArgs {
  content: string;
  project: string;
  type: 'insight' | 'decision' | 'requirement' | 'note';
  source_context?: string;
  tags?: string[];
}

export interface ResearchArgs {
  task: string;
  project?: string;
  depth?: 'quick' | 'thorough' | 'exhaustive';
  include_sources?: boolean;
}

export interface IngestArgs {
  path: string;
  source_type: SourceType;
  project?: string;
  tags?: string[];
}
