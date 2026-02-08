/**
 * List Sources Handler - List all sources with optional filtering
 */

import { getAllSources } from '../../core/vector-store.js';
import type { SourceType } from '../../core/types.js';

interface ListSourcesArgs {
  project?: string;
  source_type?: SourceType;
  limit?: number;
}

export async function handleListSources(
  dbPath: string,
  args: ListSourcesArgs
): Promise<unknown> {
  const { project: rawProject, source_type, limit = 20 } = args;
  const project = rawProject?.toLowerCase().trim();

  const sources = await getAllSources(dbPath, {
    project,
    source_type,
    limit,
  });

  return {
    sources,
    total: sources.length,
    filters: {
      project: project || 'all',
      source_type: source_type || 'all',
    },
  };
}
