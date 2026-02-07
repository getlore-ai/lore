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

// Free-form string — agents pass whatever describes the content
// Common values: meeting, interview, document, slack, email, github-issue, notion, notes, analysis
export type SourceType = string;

// ============================================================================
// Search Modes - How to search the knowledge base
// ============================================================================

export type SearchMode =
  | 'semantic'       // Vector similarity only (conceptual queries)
  | 'keyword'        // Full-text search only (exact terms)
  | 'hybrid'         // RRF fusion of semantic + keyword (default)
  | 'regex';         // Local file grep (pattern matching)

export type ContentType =
  | 'interview'      // User interview/research call
  | 'meeting'        // General meeting
  | 'conversation'   // AI conversation (Claude, ChatGPT)
  | 'document'       // Written document
  | 'note'           // Quick note/memo
  | 'analysis'       // Competitor analysis, market research
  | 'survey'         // Survey results, user feedback data
  | 'research';      // Research synthesis, literature review

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
  source_url?: string;            // Original URL for citation linking
  source_name?: string;           // Human-readable origin label
}

export interface ChunkRecord {
  id: string;
  source_id: string;
  content: string;
  type: 'quote' | 'theme' | 'summary' | 'decision' | 'requirement' | 'note' | 'insight';
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

/**
 * Extended search result with ranking information from hybrid search
 */
export interface SearchResultWithRanks extends SearchResult {
  /** Rank in semantic (vector) search results, null if not in semantic results */
  semantic_rank?: number;
  /** Rank in keyword (full-text) search results, null if not in keyword results */
  keyword_rank?: number;
}

export interface ResearchPackage {
  query: string;
  project?: string;
  generated_at: string;

  // Synthesized findings
  summary: string;
  key_findings: string[];

  // Conflict resolution (when sources contradict, shows how it was resolved)
  conflicts_resolved?: string[];

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
  mode?: SearchMode;
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
  source_url?: string;
  source_name?: string;
}
