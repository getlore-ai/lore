/**
 * Lore - Data Repository Helpers
 *
 * Shared logic for initializing and managing the lore data directory.
 * Used by both `lore setup` and `lore init`.
 */

import { mkdir, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { execFileSync } from 'child_process';
import path from 'path';

// ============================================================================
// Data Repo Init
// ============================================================================

export interface InitDataRepoResult {
  gitInitialized: boolean;
  error?: string;
}

/**
 * Initialize a lore data repository at the given path.
 * Creates directory structure, .gitignore, README, and git init.
 * Idempotent — safe to call on an existing directory.
 */
export async function initDataRepo(dirPath: string): Promise<InitDataRepoResult> {
  await mkdir(dirPath, { recursive: true });
  await mkdir(path.join(dirPath, 'sources'), { recursive: true });

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

- \`sources/\` - Ingested content, organized by project
  - \`{project}/{YYYY-MM-DD}-{slug}-{short-id}/\` - Each source document
  - \`.paths.json\` - UUID → directory index (auto-managed)

Vector embeddings are stored in Supabase (cloud) for multi-machine access.
`
    );
  }

  // Git init if not already a repo
  if (!existsSync(path.join(dirPath, '.git'))) {
    try {
      execFileSync('git', ['init'], { cwd: dirPath, stdio: 'pipe' });
      execFileSync('git', ['add', '.'], { cwd: dirPath, stdio: 'pipe' });
      execFileSync('git', ['commit', '-m', 'Initial lore data repository'], {
        cwd: dirPath,
        stdio: 'pipe',
      });
      return { gitInitialized: true };
    } catch (err: any) {
      const msg = err?.message || err?.stderr?.toString() || String(err);
      const lower = msg.toLowerCase();

      if (lower.includes('not found') || lower.includes('command not found') || lower.includes('enoent')) {
        return { gitInitialized: false, error: 'Git is not installed' };
      }
      if (lower.includes('user.email') || lower.includes('user.name') || lower.includes('please tell me who you are')) {
        return { gitInitialized: false, error: 'Git user not configured. Run: git config --global user.email "you@example.com" && git config --global user.name "Your Name"' };
      }
      return { gitInitialized: false, error: msg.slice(0, 200) };
    }
  }

  return { gitInitialized: true };
}

// ============================================================================
// Welcome Document (seeded during setup)
// ============================================================================

export const WELCOME_DOC_CONTENT = `# Getting Started with Lore

Welcome to Lore — your research knowledge repository.

## What is Lore?

Lore preserves your original sources (meeting notes, interviews, documents) and makes them searchable with full citations. Unlike a memory system, Lore keeps the original context so you can always trace back to the source.

## Quick Start

- **Search**: Run \`lore search "your query"\` to find relevant documents
- **Sync**: Run \`lore sync\` to discover and index new files from your sync sources
- **Browse**: Run \`lore browse\` to explore your knowledge base in the terminal
- **Research**: Use the \`research\` MCP tool for deep, multi-step research with citations

## Adding Documents

1. **Sync sources**: Run \`lore sync add\` to watch a directory for new files
2. **Direct ingest**: Use the \`ingest\` MCP tool to add documents from any agent
3. **Manual sync**: Run \`lore sync\` after adding files to your data directory

## Background Daemon

Run \`lore sync start\` to launch a background daemon that watches for new files and auto-indexes them. Check status with \`lore sync status\`.

## Tips

- Lore extracts metadata using AI at sync time, so your documents are enriched automatically
- Use projects to organize related documents together
- The research tool can cross-reference multiple sources and synthesize findings with citations
`;

// ============================================================================
// GitHub CLI helpers
// ============================================================================

/**
 * Check if GitHub CLI is available and authenticated.
 */
export async function isGhAvailable(): Promise<boolean> {
  try {
    execFileSync('which', ['gh'], { stdio: 'pipe' });
    execFileSync('gh', ['auth', 'status'], { stdio: 'pipe' });
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
    execFileSync('gh', ['repo', 'create', name, '--private', '--source=.', '--push'], {
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
    return execFileSync('git', ['remote', 'get-url', 'origin'], {
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
