/**
 * Brief - Storage
 *
 * Supabase CRUD and disk cache for project briefs.
 */

import { createHash } from 'crypto';
import { mkdir, writeFile, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

import {
  getSupabase,
  getSourceCount,
  getProjectStats,
} from './vector-store.js';
import type { ProjectBrief, BriefWithStaleness } from './brief-types.js';

// ============================================================================
// Supabase CRUD
// ============================================================================

/**
 * Save a brief to Supabase (append-only versioning).
 */
export async function saveBrief(
  _dbPath: string,
  dataDir: string,
  brief: ProjectBrief
): Promise<{ conflict: boolean }> {
  const client = await getSupabase();
  const normalizedProject = brief.project.toLowerCase();

  const { error } = await client.from('project_briefs').insert({
    project: normalizedProject,
    version: brief.version,
    brief_json: { ...brief, project: normalizedProject },
    source_count: brief.source_count_at_generation,
    created_at: brief.generated_at,
  });

  if (error) {
    // Version conflict (race condition) — another generation beat us.
    if (error.code === '23505') {
      console.error(`[brief] Version ${brief.version} already exists for "${normalizedProject}", skipping`);
      return { conflict: true };
    }
    console.error('[brief] Error saving to Supabase:', error);
    throw error;
  }

  // Cache to disk
  await cacheBriefToDisk(dataDir, { ...brief, project: normalizedProject });
  return { conflict: false };
}

/**
 * Get the latest brief for a project.
 */
export async function getLatestBrief(
  _dbPath: string,
  project: string
): Promise<ProjectBrief | null> {
  const client = await getSupabase();

  const { data, error } = await client
    .from('project_briefs')
    .select('brief_json')
    .eq('project', project.toLowerCase())
    .order('version', { ascending: false })
    .limit(1)
    .single();

  if (error) {
    // PGRST116 = "no rows returned" — expected when no brief exists
    if (error.code === 'PGRST116') return null;
    console.error('[brief] Error fetching brief:', error);
    throw error;
  }

  if (!data) return null;

  return data.brief_json as unknown as ProjectBrief;
}

/**
 * Get a brief with staleness information.
 */
export async function getBriefWithStaleness(
  dbPath: string,
  project: string
): Promise<BriefWithStaleness | null> {
  const normalizedProject = project.toLowerCase().trim();
  const brief = await getLatestBrief(dbPath, normalizedProject);
  if (!brief) return null;

  const currentCount = await getSourceCount(dbPath, { project: normalizedProject });
  const sourcesSince = Math.max(0, currentCount - brief.source_count_at_generation);

  return {
    ...brief,
    stale: sourcesSince > 0,
    current_source_count: currentCount,
    sources_since: sourcesSince,
  };
}

/**
 * Get all brief versions for a project (for history/diffing).
 */
export async function getBriefHistory(
  _dbPath: string,
  project: string,
  options: { limit?: number } = {}
): Promise<ProjectBrief[]> {
  const { limit = 10 } = options;
  const client = await getSupabase();

  const { data, error } = await client
    .from('project_briefs')
    .select('brief_json')
    .eq('project', project.toLowerCase())
    .order('version', { ascending: false })
    .limit(limit);

  if (error || !data) {
    return [];
  }

  return data.map((row) => row.brief_json as unknown as ProjectBrief);
}

/**
 * Get brief staleness info for all projects at once (for list views).
 */
export async function getAllBriefStatuses(
  dbPath: string
): Promise<{
  briefs: Map<string, { version: number; generated_at: string; stale: boolean; sources_since: number }>;
  projectStats: Array<{ project: string; source_count: number; quote_count: number; latest_activity: string }>;
}> {
  const client = await getSupabase();
  const result = new Map<
    string,
    { version: number; generated_at: string; stale: boolean; sources_since: number }
  >();

  // Get latest brief per project using a subquery approach:
  // Fetch all briefs, group by project, keep highest version
  const { data: briefs, error } = await client
    .from('project_briefs')
    .select('project, version, source_count, created_at')
    .order('version', { ascending: false });

  if (error || !briefs) {
    const projectStats = await getProjectStats(dbPath);
    return { briefs: result, projectStats };
  }

  // Deduplicate to latest per project
  const latestByProject = new Map<
    string,
    { version: number; source_count: number; created_at: string }
  >();
  for (const row of briefs) {
    if (!latestByProject.has(row.project)) {
      latestByProject.set(row.project, {
        version: row.version,
        source_count: row.source_count,
        created_at: row.created_at,
      });
    }
  }

  // Get current source counts per project (reuse existing function which
  // handles the full table scan; both are RLS-scoped in auth mode)
  const projectStats = await getProjectStats(dbPath);
  const projectCounts = new Map<string, number>();
  for (const stat of projectStats) {
    projectCounts.set(stat.project, stat.source_count);
  }

  for (const [project, briefInfo] of latestByProject) {
    const currentCount = projectCounts.get(project) || 0;
    const sourcesSince = Math.max(0, currentCount - briefInfo.source_count);
    result.set(project, {
      version: briefInfo.version,
      generated_at: briefInfo.created_at,
      stale: sourcesSince > 0,
      sources_since: sourcesSince,
    });
  }

  return { briefs: result, projectStats };
}

// ============================================================================
// Disk Cache
// ============================================================================

/** Sanitize project name for safe use as a filename. Hash suffix prevents collisions. */
function safeFilename(project: string): string {
  const normalized = project.toLowerCase();
  const slug = normalized.replace(/[^a-z0-9_-]/g, '_');
  const hash = createHash('sha256').update(normalized).digest('hex').slice(0, 8);
  return `${slug}_${hash}`;
}

async function cacheBriefToDisk(dataDir: string, brief: ProjectBrief): Promise<void> {
  const briefsDir = path.join(dataDir, 'briefs');

  try {
    if (!existsSync(briefsDir)) {
      await mkdir(briefsDir, { recursive: true });
    }

    const briefPath = path.join(briefsDir, `${safeFilename(brief.project)}.json`);
    await writeFile(briefPath, JSON.stringify(brief, null, 2), 'utf-8');
  } catch (error) {
    // Disk cache is best-effort
    console.error('[brief] Failed to cache to disk:', error);
  }
}

/**
 * Read brief from disk cache (fallback when Supabase is unavailable).
 */
export async function readBriefFromDisk(
  dataDir: string,
  project: string
): Promise<ProjectBrief | null> {
  const briefPath = path.join(dataDir, 'briefs', `${safeFilename(project)}.json`);

  try {
    const content = await readFile(briefPath, 'utf-8');
    return JSON.parse(content) as ProjectBrief;
  } catch {
    return null;
  }
}
