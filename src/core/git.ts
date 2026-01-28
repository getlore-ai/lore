/**
 * Git utilities for Lore data synchronization
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface GitResult {
  success: boolean;
  message?: string;
  error?: string;
}

/**
 * Check if a directory is a git repository
 */
export async function isGitRepo(dir: string): Promise<boolean> {
  try {
    await execAsync('git rev-parse --git-dir', { cwd: dir });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if the repo has a remote configured
 */
export async function hasRemote(dir: string): Promise<boolean> {
  try {
    const { stdout } = await execAsync('git remote', { cwd: dir });
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Check if there are uncommitted changes
 */
export async function hasChanges(dir: string): Promise<boolean> {
  try {
    const { stdout } = await execAsync('git status --porcelain', { cwd: dir });
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Git pull with rebase
 */
export async function gitPull(dir: string): Promise<GitResult> {
  try {
    if (!(await isGitRepo(dir))) {
      return { success: false, error: 'Not a git repository' };
    }

    if (!(await hasRemote(dir))) {
      return { success: false, error: 'No remote configured' };
    }

    // Stash any local changes
    await execAsync('git stash', { cwd: dir }).catch(() => {});

    // Pull with rebase
    const { stdout } = await execAsync('git pull --rebase', { cwd: dir });

    const pulled = !stdout.includes('Already up to date');
    return {
      success: true,
      message: pulled ? 'Pulled new changes' : 'Already up to date'
    };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

/**
 * Git add, commit, and push
 */
export async function gitCommitAndPush(
  dir: string,
  message: string
): Promise<GitResult> {
  try {
    if (!(await isGitRepo(dir))) {
      return { success: false, error: 'Not a git repository' };
    }

    // Check for changes
    if (!(await hasChanges(dir))) {
      return { success: true, message: 'No changes to commit' };
    }

    // Stage all changes
    await execAsync('git add -A', { cwd: dir });

    // Commit
    await execAsync(`git commit -m "${message.replace(/"/g, '\\"')}"`, { cwd: dir });

    // Push if remote exists
    if (await hasRemote(dir)) {
      await execAsync('git push', { cwd: dir });
      return { success: true, message: 'Committed and pushed' };
    } else {
      return { success: true, message: 'Committed (no remote to push)' };
    }
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

/**
 * Sync: pull, then push any local changes
 */
export async function gitSync(dir: string): Promise<GitResult> {
  try {
    if (!(await isGitRepo(dir))) {
      return { success: false, error: 'Not a git repository' };
    }

    if (!(await hasRemote(dir))) {
      return { success: false, error: 'No remote configured' };
    }

    // Pull first
    const pullResult = await gitPull(dir);
    if (!pullResult.success) {
      return pullResult;
    }

    // Push any local changes
    if (await hasChanges(dir)) {
      await execAsync('git add -A', { cwd: dir });
      await execAsync('git commit -m "Auto-sync from Lore"', { cwd: dir });
      await execAsync('git push', { cwd: dir });
      return { success: true, message: 'Pulled and pushed changes' };
    }

    return { success: true, message: pullResult.message };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}
