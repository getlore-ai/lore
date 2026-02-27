/**
 * Brief - Types
 *
 * Interfaces and constants for project briefs.
 */

// ~100K tokens — safe within Sonnet's 200K context
export const CONTENT_BUDGET_BYTES = 400 * 1024;
// Safety cap even with chunking
export const MAX_SOURCES_ABSOLUTE = 500;

export interface BriefEvidence {
  claim: string;
  source_id: string;
  source_title: string;
  quote?: string;
  date: string;
}

export interface ProjectBrief {
  project: string;
  version: number;
  generated_at: string;

  // Synthesis sections
  current_state: string;
  key_evidence: BriefEvidence[];
  open_questions: string[];
  trajectory: string;
  recent_changes: string | null;

  // Metadata
  source_count_at_generation: number;
  focus?: string;
}

export interface BriefWithStaleness extends ProjectBrief {
  stale: boolean;
  current_source_count: number;
  sources_since: number;
}

/** Source type alias used throughout generation helpers. */
export type SourceInfo = {
  id: string;
  title: string;
  source_type: string;
  content_type: string;
  projects: string[];
  created_at: string;
  indexed_at: string;
  summary: string;
};
