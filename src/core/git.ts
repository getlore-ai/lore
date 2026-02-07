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

    // Stash any local changes before pulling
    let didStash = false;
    if (await hasChanges(dir)) {
      try {
        const { stdout: stashOut } = await execAsync('git stash', { cwd: dir });
        didStash = !stashOut.includes('No local changes');
      } catch (stashErr) {
        console.error(`[git] Stash failed: ${stashErr}`);
      }
    }

    // Pull with rebase
    let pullOutput: string;
    try {
      const { stdout } = await execAsync('git pull --rebase', { cwd: dir });
      pullOutput = stdout;
    } catch (pullErr) {
      // Restore stashed changes before returning error
      if (didStash) {
        await execAsync('git stash pop', { cwd: dir }).catch((popErr) => {
          console.error(`[git] Stash pop failed after pull error: ${popErr}`);
        });
      }
      throw pullErr;
    }

    // Restore stashed changes after successful pull
    if (didStash) {
      try {
        await execAsync('git stash pop', { cwd: dir });
      } catch (popErr) {
        console.error(`[git] Stash pop failed (possible conflict): ${popErr}`);
        // Don't fail the pull — stashed content is still in `git stash list`
      }
    }

    const pulled = !pullOutput.includes('Already up to date');
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
 * Delete a file and commit the removal to its git repo (if git-tracked).
 * No-op if the file doesn't exist.
 */
export async function deleteFileAndCommit(
  filePath: string,
  commitMessage: string
): Promise<void> {
  const { existsSync } = await import('fs');
  if (!existsSync(filePath)) return;

  const { rm } = await import('fs/promises');
  const dir = (await import('path')).dirname(filePath);

  await rm(filePath);

  if (await isGitRepo(dir)) {
    await gitCommitAndPush(dir, commitMessage);
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
