/**
 * List Projects Handler - Show all projects with stats
 */

import { getProjectStats } from '../../core/vector-store.js';

export async function handleListProjects(dbPath: string): Promise<unknown> {
  const projects = await getProjectStats(dbPath);

  return {
    projects: projects.map((p) => ({
      name: p.project,
      source_count: p.source_count,
      quote_count: p.quote_count,
      latest_activity: p.latest_activity,
    })),
    total: projects.length,
  };
}
