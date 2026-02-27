/**
 * Vector Store - Statistics
 *
 * Theme and project statistics aggregation.
 */

import type { Quote, Theme } from './types.js';
import { getSupabase } from './vector-store-client.js';

export async function getThemeStats(
  _dbPath: string,
  project?: string
): Promise<Map<string, { source_count: number; quote_count: number }>> {
  const client = await getSupabase();
  const stats = new Map<string, { source_count: number; quote_count: number }>();

  let query = client.from('sources').select('themes_json, quotes_json, projects').is('deleted_at', null);

  if (project) {
    query = query.contains('projects', [project]);
  }

  const { data, error } = await query;

  if (error) {
    console.error('Error getting theme stats:', error);
    return stats;
  }

  for (const row of data || []) {
    const themes = (row.themes_json || []) as Theme[];
    for (const theme of themes) {
      const existing = stats.get(theme.name) || { source_count: 0, quote_count: 0 };
      existing.source_count++;
      existing.quote_count += theme.evidence?.length || 0;
      stats.set(theme.name, existing);
    }
  }

  return stats;
}

export async function getProjectStats(
  _dbPath: string
): Promise<
  Array<{
    project: string;
    source_count: number;
    quote_count: number;
    latest_activity: string;
  }>
> {
  const client = await getSupabase();
  const projectMap = new Map<
    string,
    { source_count: number; quote_count: number; latest_activity: string }
  >();

  const { data, error } = await client
    .from('sources')
    .select('projects, quotes_json, created_at')
    .is('deleted_at', null);

  if (error) {
    console.error('Error getting project stats:', error);
    return [];
  }

  for (const row of data || []) {
    const projects = row.projects as string[];
    const quotes = (row.quotes_json || []) as Quote[];
    const created_at = row.created_at as string;

    for (const project of projects) {
      const existing = projectMap.get(project) || {
        source_count: 0,
        quote_count: 0,
        latest_activity: created_at,
      };
      existing.source_count++;
      existing.quote_count += quotes.length;
      if (new Date(created_at) > new Date(existing.latest_activity)) {
        existing.latest_activity = created_at;
      }
      projectMap.set(project, existing);
    }
  }

  return Array.from(projectMap.entries())
    .map(([project, stats]) => ({ project, ...stats }))
    .sort((a, b) => new Date(b.latest_activity).getTime() - new Date(a.latest_activity).getTime());
}
