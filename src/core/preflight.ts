/**
 * Lore - Preflight Checks & Validation
 *
 * Utility functions for validating environment and API keys during setup.
 */

import { execSync } from 'child_process';

// ============================================================================
// Git Checks
// ============================================================================

export interface GitCheckResult {
  installed: boolean;
  configured: boolean;
  version?: string;
}

/**
 * Check if git is installed and configured (user.email + user.name).
 */
export function checkGit(): GitCheckResult {
  try {
    execSync('which git', { stdio: 'pipe' });
  } catch {
    return { installed: false, configured: false };
  }

  let version: string | undefined;
  try {
    const raw = execSync('git --version', { stdio: 'pipe' }).toString().trim();
    // "git version 2.43.0" → "2.43.0"
    version = raw.replace(/^git version\s*/, '');
  } catch {
    // git exists but --version failed — unusual, treat as installed but unknown version
  }

  let configured = true;
  try {
    const email = execSync('git config user.email', { stdio: 'pipe' }).toString().trim();
    const name = execSync('git config user.name', { stdio: 'pipe' }).toString().trim();
    if (!email || !name) configured = false;
  } catch {
    configured = false;
  }

  return { installed: true, configured, version };
}

// ============================================================================
// API Key Validation
// ============================================================================

export interface KeyValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validate an OpenAI API key by calling models.list with a short timeout.
 */
export async function validateOpenAIKey(key: string): Promise<KeyValidationResult> {
  try {
    const { default: OpenAI } = await import('openai');
    const client = new OpenAI({ apiKey: key, timeout: 5000 });
    await client.models.list();
    return { valid: true };
  } catch (err: any) {
    const status = err?.status || err?.response?.status;
    if (status === 401) return { valid: false, error: 'Invalid key (401 Unauthorized)' };
    if (status === 429) return { valid: true }; // Rate limited = key is valid
    if (err?.code === 'ETIMEDOUT' || err?.code === 'ECONNABORTED') {
      return { valid: false, error: 'Connection timed out' };
    }
    return { valid: false, error: err?.message || 'Unknown error' };
  }
}

/**
 * Validate an Anthropic API key by calling messages.create with max_tokens: 1.
 */
export async function validateAnthropicKey(key: string): Promise<KeyValidationResult> {
  try {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: key, timeout: 5000 });
    await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1,
      messages: [{ role: 'user', content: 'hi' }],
    });
    return { valid: true };
  } catch (err: any) {
    const status = err?.status || err?.response?.status;
    if (status === 401) return { valid: false, error: 'Invalid key (401 Unauthorized)' };
    if (status === 429) return { valid: true }; // Rate limited = key is valid
    if (err?.code === 'ETIMEDOUT' || err?.code === 'ECONNABORTED') {
      return { valid: false, error: 'Connection timed out' };
    }
    return { valid: false, error: err?.message || 'Unknown error' };
  }
}

// ============================================================================
// Git Remote Analysis
// ============================================================================

export interface GitRemoteAnalysis {
  isSSH: boolean;
  httpsEquivalent?: string;
}

/**
 * Analyze a git remote URL. Detects SSH URLs and provides HTTPS equivalents for GitHub.
 */
export function analyzeGitRemote(url: string): GitRemoteAnalysis {
  // SSH patterns: git@github.com:user/repo.git, ssh://git@github.com/user/repo.git
  const sshPattern = /^git@([^:]+):(.+?)(?:\.git)?$/;
  const sshUrlPattern = /^ssh:\/\/git@([^/]+)\/(.+?)(?:\.git)?$/;

  let match = url.match(sshPattern);
  if (match) {
    const [, host, path] = match;
    const httpsEquivalent = host.includes('github.com')
      ? `https://github.com/${path}.git`
      : undefined;
    return { isSSH: true, httpsEquivalent };
  }

  match = url.match(sshUrlPattern);
  if (match) {
    const [, host, path] = match;
    const httpsEquivalent = host.includes('github.com')
      ? `https://github.com/${path}.git`
      : undefined;
    return { isSSH: true, httpsEquivalent };
  }

  return { isSSH: false };
}

// ============================================================================
// Daemon Error Hints
// ============================================================================

/**
 * Given a raw git error message, return an actionable hint for the user.
 * Returns null if no specific hint is available.
 */
export function getGitErrorHint(errorMessage: string): string | null {
  const msg = errorMessage.toLowerCase();

  if (msg.includes('permission denied (publickey)') || msg.includes('permission denied')) {
    return 'SSH auth failed. Consider switching to HTTPS: git remote set-url origin https://github.com/<user>/<repo>.git';
  }

  if (msg.includes('could not resolve host')) {
    return 'Network unreachable. Will retry next cycle.';
  }

  if (msg.includes('authentication failed') || msg.includes('invalid credentials')) {
    return 'Git credentials expired. Fix: gh auth login (or update your credential manager)';
  }

  if (msg.includes('not a git repository')) {
    return 'Data directory is not a git repo. Fix: run lore setup';
  }

  if (msg.includes('could not read from remote') || msg.includes('repository not found')) {
    return 'Remote repository not accessible. Check the URL with: git remote -v';
  }

  if (msg.includes('merge conflict') || msg.includes('needs merge')) {
    return 'Merge conflict in data repo. Fix: cd <data-dir> && git status (resolve conflicts manually)';
  }

  return null;
}
