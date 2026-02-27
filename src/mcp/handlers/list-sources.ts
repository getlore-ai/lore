/**
 * List Sources Handler - List all sources with optional filtering
 */

import { getAllSources, getSourceCount } from '../../core/vector-store.js';
import type { SourceType } from '../../core/types.js';

interface ListSourcesArgs {
  project?: string;
  source_type?: SourceType;
  limit?: number;
  include_logs?: boolean;
}

export async function handleListSources(
  dbPath: string,
  args: ListSourcesArgs
): Promise<unknown> {
  const { project: rawProject, source_type, limit, include_logs } = args;
  const project = rawProject?.toLowerCase().trim();

  const sources = await getAllSources(dbPath, {
    project,
    source_type,
    exclude_source_type: include_logs ? undefined : 'log',
    limit,
  });

  // Get total count when limit is applied (so callers know if results are truncated)
  let totalCount = sources.length;
  if (limit && sources.length >= limit) {
    totalCount = await getSourceCount(dbPath, {
      project,
      source_type,
      exclude_source_type: include_logs ? undefined : 'log',
    });
  }

  return {
    sources,
    total: totalCount,
    showing: sources.length,
    filters: {
      project: project || 'all',
      source_type: source_type || 'all',
    },
  };
}
