/**
 * Lore - Data Repository Helpers
 *
 * Shared logic for initializing and managing the lore data directory.
 * Used by both `lore setup` and `lore init`.
 */

import { mkdir, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { execSync } from 'child_process';
import path from 'path';

// ============================================================================
// Data Repo Init
// ============================================================================

/**
 * Initialize a lore data repository at the given path.
 * Creates directory structure, .gitignore, README, and git init.
 * Idempotent — safe to call on an existing directory.
 */
export async function initDataRepo(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true });
  await mkdir(path.join(dirPath, 'sources'), { recursive: true });
  await mkdir(path.join(dirPath, 'retained'), { recursive: true });

  // Create .gitignore if missing
  const gitignorePath = path.join(dirPath, '.gitignore');
  if (!existsSync(gitignorePath)) {
    await writeFile(gitignorePath, `.env\n.env.local\n`);
  }

  // Create README if missing
  const readmePath = path.join(dirPath, 'README.md');
  if (!existsSync(readmePath)) {
    await writeFile(
      readmePath,
      `# Lore Data Repository

Your personal knowledge repository for Lore.

## Structure

- \`sources/\` - Ingested documents
- \`retained/\` - Explicitly saved insights

Vector embeddings are stored in Supabase (cloud) for multi-machine access.
`
    );
  }

  // Git init if not already a repo
  if (!existsSync(path.join(dirPath, '.git'))) {
    try {
      execSync('git init', { cwd: dirPath, stdio: 'pipe' });
      execSync('git add .', { cwd: dirPath, stdio: 'pipe' });
      execSync('git commit -m "Initial lore data repository"', {
        cwd: dirPath,
        stdio: 'pipe',
      });
    } catch {
      // git not installed or commit failed — non-fatal
    }
  }
}

// ============================================================================
// GitHub CLI helpers
// ============================================================================

/**
 * Check if GitHub CLI is available and authenticated.
 */
export async function isGhAvailable(): Promise<boolean> {
  try {
    execSync('which gh', { stdio: 'pipe' });
    execSync('gh auth status', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Create a private GitHub repo from the given local directory.
 * Returns the repo URL on success, null on failure.
 */
export async function createGithubRepo(
  dirPath: string,
  name: string
): Promise<string | null> {
  try {
    execSync(`gh repo create ${name} --private --source=. --push`, {
      cwd: dirPath,
      stdio: 'pipe',
    });
    return getGitRemoteUrl(dirPath);
  } catch {
    return null;
  }
}

/**
 * Get the git remote origin URL for a directory.
 * Returns null if no remote is configured.
 */
export function getGitRemoteUrl(dirPath: string): string | null {
  try {
    return execSync('git remote get-url origin', {
      cwd: dirPath,
      stdio: 'pipe',
    })
      .toString()
      .trim();
  } catch {
    return null;
  }
}

/**
 * Check if a directory is a git repository.
 */
export function isGitRepo(dirPath: string): boolean {
  return existsSync(path.join(dirPath, '.git'));
}
