/**
 * Brief - Auto Update
 *
 * Debounced, per-project brief updater. Called fire-and-forget after ingest.
 * Only updates existing briefs — does not auto-create for new projects.
 */

import { generateBrief } from './brief-generation.js';
import { getLatestBrief } from './brief-storage.js';

const DEBOUNCE_MS = 5000;

const pendingProjects = new Map<string, NodeJS.Timeout>();
const inFlight = new Set<string>();

/**
 * Schedule a background brief update for a project.
 * Debounces rapid calls (5s window). Only updates if a brief already exists.
 */
export function scheduleBriefUpdate(dbPath: string, dataDir: string, project: string): void {
  const key = project.toLowerCase().trim();

  // Reset debounce timer
  const existing = pendingProjects.get(key);
  if (existing) {
    clearTimeout(existing);
  }

  const timer = setTimeout(() => {
    pendingProjects.delete(key);
    void runBriefUpdate(dbPath, dataDir, key);
  }, DEBOUNCE_MS);

  pendingProjects.set(key, timer);
}

async function runBriefUpdate(dbPath: string, dataDir: string, project: string): Promise<void> {
  // Don't run concurrent generations for the same project.
  // The running generation will produce a brief that is current enough —
  // any remaining gap is surfaced by the staleness mechanism.
  if (inFlight.has(project)) {
    return;
  }

  inFlight.add(project);
  try {
    const existing = await getLatestBrief(dbPath, project);
    if (!existing) {
      return; // No brief exists — don't auto-create
    }

    const GENERATION_TIMEOUT_MS = 5 * 60 * 1000;
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Brief generation timed out')), GENERATION_TIMEOUT_MS)
    );
    const updated = await Promise.race([generateBrief(dbPath, dataDir, project), timeout]);
    console.error(`[brief-auto-update] "${project}" updated to v${updated.version}`);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('auth login') || msg.includes('SUPABASE_URL')) {
      return; // Auth not configured — silent skip
    }
    console.error(`[brief-auto-update] Failed to update brief for "${project}":`, error);
  } finally {
    inFlight.delete(project);
  }
}
