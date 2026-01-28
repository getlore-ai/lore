/**
 * Search Handler - Semantic search across sources
 */

import { searchSources, getSourceById } from '../../core/vector-store.js';
import { generateEmbedding } from '../../core/embedder.js';
import type { SourceType, ContentType, Quote, Theme } from '../../core/types.js';

interface SearchArgs {
  query: string;
  project?: string;
  source_type?: SourceType;
  content_type?: ContentType;
  limit?: number;
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
}

export async function handleSearch(
  dbPath: string,
  args: SearchArgs
): Promise<SearchResult> {
  const { query, project, source_type, content_type, limit = 10 } = args;

  // Generate embedding for query
  const queryVector = await generateEmbedding(query);

  // Search sources
  const results = await searchSources(dbPath, queryVector, {
    limit,
    project,
    source_type,
    content_type,
  });

  // Format results with relevant quotes highlighted
  const sources = results.map((result) => {
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
  };
}
