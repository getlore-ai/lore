/**
 * Search Handler - Semantic search across sources
 *
 * By default, excludes sources from archived projects.
 * Use include_archived: true to search everything.
 */

import { searchSources, getSourceById } from '../../core/vector-store.js';
import { generateEmbedding } from '../../core/embedder.js';
import { loadArchivedProjects } from './archive-project.js';
import type { SourceType, ContentType, Quote, Theme } from '../../core/types.js';

interface SearchArgs {
  query: string;
  project?: string;
  source_type?: SourceType;
  content_type?: ContentType;
  limit?: number;
  include_archived?: boolean;
}

interface SearchResult {
  sources: Array<{
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
  }>;
  total_found: number;
  query: string;
  archived_excluded?: number;
}

export async function handleSearch(
  dbPath: string,
  dataDir: string,
  args: SearchArgs
): Promise<SearchResult> {
  const { query, project, source_type, content_type, limit = 10, include_archived = false } = args;

  // Generate embedding for query
  const queryVector = await generateEmbedding(query);

  // Search sources (fetch more to account for archived filtering)
  const fetchLimit = include_archived ? limit : limit * 2;
  const results = await searchSources(dbPath, queryVector, {
    limit: fetchLimit,
    project,
    source_type,
    content_type,
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

  // Format results with relevant quotes highlighted
  const sources = filteredResults.slice(0, limit).map((result) => {
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
    };
  });

  return {
    sources,
    total_found: sources.length,
    query,
    archived_excluded: archivedExcluded > 0 ? archivedExcluded : undefined,
  };
}
