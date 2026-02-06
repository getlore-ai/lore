/**
 * Archive Project Handler - Mark a project as archived
 *
 * Archived projects are excluded from search by default but preserved for history.
 * This is a human-triggered curation action, not automatic.
 * Auto-pushes to git remote if configured.
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { getProjectStats } from '../../core/vector-store.js';
import { gitCommitAndPush } from '../../core/git.js';

interface ArchivedProject {
  project: string;
  archived_at: string;
  reason?: string;
  successor_project?: string;
}

interface ArchiveProjectArgs {
  project: string;
  reason?: string;
  successor_project?: string;
}

interface ArchiveProjectResult {
  success: boolean;
  project: string;
  archived_at: string;
  reason?: string;
  successor_project?: string;
  sources_affected: number;
  synced?: boolean;
  error?: string;
}

const ARCHIVED_PROJECTS_FILE = 'archived-projects.json';

/**
 * Load archived projects list
 */
export async function loadArchivedProjects(dataDir: string): Promise<ArchivedProject[]> {
  const filePath = path.join(dataDir, ARCHIVED_PROJECTS_FILE);
  try {
    const content = await readFile(filePath, 'utf-8');
    return JSON.parse(content) as ArchivedProject[];
  } catch {
    return [];
  }
}

/**
 * Save archived projects list
 */
async function saveArchivedProjects(dataDir: string, projects: ArchivedProject[]): Promise<void> {
  const filePath = path.join(dataDir, ARCHIVED_PROJECTS_FILE);
  await mkdir(dataDir, { recursive: true });
  await writeFile(filePath, JSON.stringify(projects, null, 2));
}

/**
 * Check if a project is archived
 */
export async function isProjectArchived(dataDir: string, project: string): Promise<boolean> {
  const archived = await loadArchivedProjects(dataDir);
  return archived.some((p) => p.project.toLowerCase() === project.toLowerCase());
}

/**
 * Get archived project info
 */
export async function getArchivedProjectInfo(
  dataDir: string,
  project: string
): Promise<ArchivedProject | null> {
  const archived = await loadArchivedProjects(dataDir);
  return archived.find((p) => p.project.toLowerCase() === project.toLowerCase()) || null;
}

export async function handleArchiveProject(
  dbPath: string,
  dataDir: string,
  args: ArchiveProjectArgs,
  options: { autoPush?: boolean } = {}
): Promise<ArchiveProjectResult> {
  const { project, reason, successor_project } = args;
  const { autoPush = true } = options;

  // Check if project exists
  const projectStats = await getProjectStats(dbPath);
  const existingProject = projectStats.find(
    (p) => p.project.toLowerCase() === project.toLowerCase()
  );

  if (!existingProject) {
    return {
      success: false,
      project,
      archived_at: new Date().toISOString(),
      error: `Project "${project}" not found`,
      sources_affected: 0,
    };
  }

  // Check if already archived
  const alreadyArchived = await isProjectArchived(dataDir, project);
  if (alreadyArchived) {
    return {
      success: false,
      project,
      archived_at: new Date().toISOString(),
      error: `Project "${project}" is already archived`,
      sources_affected: 0,
    };
  }

  // Add to archived list
  const archived = await loadArchivedProjects(dataDir);
  const archivedProject: ArchivedProject = {
    project: existingProject.project, // Use exact case from DB
    archived_at: new Date().toISOString(),
    reason,
    successor_project,
  };
  archived.push(archivedProject);
  await saveArchivedProjects(dataDir, archived);

  // Auto-push to git if enabled
  let synced = false;
  if (autoPush) {
    const pushResult = await gitCommitAndPush(
      dataDir,
      `Archive project: ${existingProject.project}${reason ? ` (${reason})` : ''}`
    );
    synced = pushResult.success && (pushResult.message?.includes('pushed') || false);
  }

  return {
    success: true,
    project: existingProject.project,
    archived_at: archivedProject.archived_at,
    reason,
    successor_project,
    sources_affected: existingProject.source_count,
    synced,
  };
}

/**
 * Unarchive a project (restore to active)
 */
export async function handleUnarchiveProject(
  dataDir: string,
  project: string
): Promise<{ success: boolean; error?: string }> {
  const archived = await loadArchivedProjects(dataDir);
  const index = archived.findIndex((p) => p.project.toLowerCase() === project.toLowerCase());

  if (index === -1) {
    return { success: false, error: `Project "${project}" is not archived` };
  }

  archived.splice(index, 1);
  await saveArchivedProjects(dataDir, archived);

  return { success: true };
}
