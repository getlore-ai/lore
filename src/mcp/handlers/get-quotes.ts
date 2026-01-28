/**
 * Get Quotes Handler - Find quotes with citations
 */

import { searchChunks, getSourceById } from '../../core/vector-store.js';
import { generateEmbedding } from '../../core/embedder.js';
import type { ThemeName } from '../../core/types.js';

interface GetQuotesArgs {
  query?: string;
  theme?: ThemeName;
  project?: string;
  limit?: number;
}

interface QuoteResult {
  text: string;
  speaker?: string;
  timestamp?: string;
  theme?: string;
  source: {
    id: string;
    title: string;
    type: string;
  };
  relevance_score?: number;
}

export async function handleGetQuotes(
  dbPath: string,
  args: GetQuotesArgs
): Promise<{ quotes: QuoteResult[]; total: number }> {
  const { query, theme, project, limit = 20 } = args;

  let results: Array<{
    id: string;
    source_id: string;
    content: string;
    type: string;
    theme_name: string;
    speaker: string;
    timestamp: string;
    score: number;
  }> = [];

  if (query) {
    // Semantic search for quotes
    const queryVector = await generateEmbedding(query);
    results = await searchChunks(dbPath, queryVector, {
      limit,
      type: 'quote',
      theme_name: theme,
    });
  } else if (theme) {
    // Just filter by theme (use a generic embedding)
    const queryVector = await generateEmbedding(`${theme} user feedback`);
    results = await searchChunks(dbPath, queryVector, {
      limit: limit * 2,
      type: 'quote',
      theme_name: theme,
    });
    results = results.slice(0, limit);
  } else {
    return { quotes: [], total: 0 };
  }

  // Enrich with source info
  const sourceCache = new Map<string, { title: string; type: string }>();
  const quotes: QuoteResult[] = [];

  for (const result of results) {
    // Get source info (with caching)
    let sourceInfo = sourceCache.get(result.source_id);
    if (!sourceInfo) {
      const source = await getSourceById(dbPath, result.source_id);
      if (source) {
        sourceInfo = { title: source.title, type: source.source_type };
        sourceCache.set(result.source_id, sourceInfo);
      } else {
        sourceInfo = { title: 'Unknown', type: 'unknown' };
      }
    }

    quotes.push({
      text: result.content,
      speaker: result.speaker || undefined,
      timestamp: result.timestamp || undefined,
      theme: result.theme_name || undefined,
      source: {
        id: result.source_id,
        title: sourceInfo.title,
        type: sourceInfo.type,
      },
      relevance_score: result.score,
    });
  }

  return { quotes, total: quotes.length };
}
