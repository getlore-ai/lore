/**
 * Search Handler - Semantic and hybrid search across sources
 *
 * Supports multiple search modes:
 * - semantic: Vector similarity only (conceptual queries)
 * - keyword: Full-text search only (exact terms)
 * - hybrid: RRF fusion of semantic + keyword (default)
 * - regex: Local file grep (pattern matching)
 *
 * By default, excludes sources from archived projects.
 * Use include_archived: true to search everything.
 */

import { searchSources, getSourceById } from '../../core/vector-store.js';
import { generateEmbedding } from '../../core/embedder.js';
import { searchLocalFiles, getMatchSnippet } from '../../core/local-search.js';
import { loadArchivedProjects } from './archive-project.js';
import { detectTemporalIntent, parseDateArg, filterByDateRange, sortByRecency } from '../../core/temporal.js';
import type { SourceType, ContentType, Quote, Theme, SearchMode } from '../../core/types.js';

interface SearchArgs {
  query: string;
  project?: string;
  source_type?: SourceType;
  content_type?: ContentType;
  limit?: number;
  include_archived?: boolean;
  mode?: SearchMode;
  since?: string;
  before?: string;
  sort?: 'relevance' | 'recent';
}

interface SearchResultSource {
  id: string;
  title: string;
  source_type: SourceType;
  content_type: ContentType;
  projects: string[];
  created_at: string;
  summary: string;
  relevance_score: number;
  matching_quotes: Quote[];
  themes: string[];
  /** Rank in semantic search (only for hybrid/semantic modes) */
  semantic_rank?: number;
  /** Rank in keyword search (only for hybrid/keyword modes) */
  keyword_rank?: number;
  /** Matching lines (only for regex mode) */
  matching_lines?: Array<{
    line_number: number;
    snippet: string;
  }>;
}

interface SearchResult {
  sources: SearchResultSource[];
  total_found: number;
  query: string;
  mode: SearchMode;
  archived_excluded?: number;
}

export async function handleSearch(
  dbPath: string,
  dataDir: string,
  args: SearchArgs
): Promise<SearchResult> {
  const {
    query,
    project: rawProject,
    source_type,
    content_type,
    limit = 10,
    include_archived = false,
    mode = 'hybrid',
    since: rawSince,
    before: rawBefore,
    sort,
  } = args;
  const project = rawProject?.toLowerCase().trim();

  // Handle regex mode separately - uses local file search
  if (mode === 'regex') {
    return handleRegexSearch(dbPath, dataDir, {
      query,
      project,
      limit,
      include_archived,
    });
  }

  // Detect temporal intent for auto recency boost
  const temporal = detectTemporalIntent(query);

  // Parse date filters
  const since = rawSince ? parseDateArg(rawSince) : null;
  const before = rawBefore ? parseDateArg(rawBefore) : null;

  // Generate embedding for query (needed for semantic/hybrid modes)
  const queryVector = await generateEmbedding(query);

  // Search sources (fetch more to account for archived + date filtering)
  const hasDateFilter = !!(since || before);
  const fetchLimit = (include_archived ? limit : limit * 2) * (hasDateFilter ? 2 : 1);
  const results = await searchSources(dbPath, queryVector, {
    limit: fetchLimit,
    project,
    source_type,
    content_type,
    mode,
    queryText: query,
    recency_boost: temporal.recencyBoost,
  });

  // Filter out archived projects unless explicitly requested
  let filteredResults = results;
  let archivedExcluded = 0;

  if (!include_archived) {
    const archivedProjects = await loadArchivedProjects(dataDir);
    const archivedNames = new Set(archivedProjects.map((p) => p.project.toLowerCase()));

    filteredResults = results.filter((result) => {
      const isArchived = result.projects.some((p) => archivedNames.has(p.toLowerCase()));
      if (isArchived) archivedExcluded++;
      return !isArchived;
    });
  }

  // Post-filter by date range
  if (since || before) {
    filteredResults = filterByDateRange(filteredResults, since, before);
  }

  // Sort by date if explicitly requested or temporal intent detected
  if (sort === 'recent' || temporal.sortByDate) {
    filteredResults = sortByRecency(filteredResults);
  }

  // Format results with relevant quotes highlighted
  const sources: SearchResultSource[] = filteredResults.slice(0, limit).map((result) => {
    // Find quotes most relevant to the query (simple keyword match for now)
    const queryWords = query.toLowerCase().split(/\s+/);
    const matchingQuotes = result.quotes
      .filter((q) => queryWords.some((word) => q.text.toLowerCase().includes(word)))
      .slice(0, 3);

    return {
      id: result.id,
      title: result.title,
      source_type: result.source_type,
      content_type: result.content_type,
      projects: result.projects,
      created_at: result.created_at,
      summary: result.summary,
      relevance_score: result.score,
      matching_quotes: matchingQuotes,
      themes: result.themes.map((t) => t.name),
      semantic_rank: result.semantic_rank,
      keyword_rank: result.keyword_rank,
    };
  });

  return {
    sources,
    total_found: sources.length,
    query,
    mode,
    archived_excluded: archivedExcluded > 0 ? archivedExcluded : undefined,
  };
}

/**
 * Handle regex search using local file grep
 */
async function handleRegexSearch(
  dbPath: string,
  dataDir: string,
  args: {
    query: string;
    project?: string;
    limit?: number;
    include_archived?: boolean;
  }
): Promise<SearchResult> {
  const { query, project, limit = 10, include_archived = false } = args;

  // Search local files
  const localResults = await searchLocalFiles(dataDir, query, {
    maxTotalResults: limit * 2, // Fetch extra for filtering
    maxMatchesPerFile: 5,
    ignoreCase: false,
  });

  // Get source details from database to enrich results
  const sources: SearchResultSource[] = [];
  let archivedExcluded = 0;

  const archivedProjects = include_archived
    ? []
    : await loadArchivedProjects(dataDir);
  const archivedNames = new Set(archivedProjects.map((p) => p.project.toLowerCase()));

  for (const localResult of localResults) {
    if (sources.length >= limit) break;

    // Get source metadata from database
    const sourceData = await getSourceById(dbPath, localResult.source_id);
    if (!sourceData) continue;

    // Filter by project if specified
    if (project && !sourceData.projects.includes(project)) continue;

    // Filter out archived projects
    if (!include_archived) {
      const isArchived = sourceData.projects.some((p) => archivedNames.has(p.toLowerCase()));
      if (isArchived) {
        archivedExcluded++;
        continue;
      }
    }

    // Format matching lines
    const matchingLines = localResult.matches.slice(0, 3).map((m) => ({
      line_number: m.line_number,
      snippet: getMatchSnippet(m.line_content, m.match_start, m.match_end, 80),
    }));

    sources.push({
      id: sourceData.id,
      title: sourceData.title,
      source_type: sourceData.source_type,
      content_type: sourceData.content_type,
      projects: sourceData.projects,
      created_at: sourceData.created_at,
      summary: sourceData.summary,
      relevance_score: localResult.matches.length / 10, // Simple score based on match count
      matching_quotes: [],
      themes: sourceData.themes.map((t) => t.name),
      matching_lines: matchingLines,
    });
  }

  return {
    sources,
    total_found: sources.length,
    query,
    mode: 'regex',
    archived_excluded: archivedExcluded > 0 ? archivedExcluded : undefined,
  };
}
