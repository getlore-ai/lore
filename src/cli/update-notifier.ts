/**
 * Passive Update Notifier
 *
 * Checks npm for a newer version of @getlore/cli once every 24 hours.
 * Prints a subtle notification after command output if an update is available.
 * Never blocks or throws — all errors are silently swallowed.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { spawnSync } from 'child_process';
import path from 'path';
import os from 'os';
import { colors } from './colors.js';
import { getLoreVersionString } from '../extensions/registry.js';

const NPM_PACKAGE = '@getlore/cli';
const CONFIG_DIR = path.join(os.homedir(), '.config', 'lore');
const CACHE_FILE = path.join(CONFIG_DIR, 'update-check.json');
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface UpdateCache {
  last_check: number;
  latest_version: string;
  last_notified_version?: string;
}

function readCache(): UpdateCache | null {
  try {
    if (!existsSync(CACHE_FILE)) return null;
    return JSON.parse(readFileSync(CACHE_FILE, 'utf-8'));
  } catch {
    return null;
  }
}

function writeCache(cache: UpdateCache): void {
  try {
    if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
    writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
  } catch {
    // Silently ignore
  }
}

/**
 * Check for updates and print a notification if one is available.
 * Safe to call fire-and-forget — never throws, never blocks meaningfully.
 */
export async function checkForUpdates(): Promise<void> {
  // Don't notify in non-interactive contexts
  if (!process.stdout.isTTY) return;

  const cache = readCache();
  const now = Date.now();

  let latestVersion: string;

  if (cache && (now - cache.last_check) < CHECK_INTERVAL_MS) {
    // Use cached value
    latestVersion = cache.latest_version;
  } else {
    // Fetch from npm with short timeout
    const result = spawnSync('npm', ['view', NPM_PACKAGE, 'version'], {
      encoding: 'utf-8',
      timeout: 5_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (result.status !== 0 || !result.stdout) return;
    latestVersion = result.stdout.trim();

    writeCache({
      last_check: now,
      latest_version: latestVersion,
      last_notified_version: cache?.last_notified_version,
    });
  }

  const currentVersion = await getLoreVersionString();
  if (!currentVersion || currentVersion === latestVersion) return;

  // Don't re-notify for the same version
  if (cache?.last_notified_version === latestVersion) return;

  // Print notification
  const border = `${colors.dim}╭────────────────────────────────────────╮${colors.reset}`;
  const bottom = `${colors.dim}╰────────────────────────────────────────╯${colors.reset}`;
  const pad = (s: string, width: number) => {
    // Strip ANSI for length calculation
    const stripped = s.replace(/\x1b\[[0-9;]*m/g, '');
    const padding = Math.max(0, width - stripped.length);
    return s + ' '.repeat(padding);
  };

  console.log('');
  console.log(border);
  console.log(`${colors.dim}│${colors.reset} ${pad(`Update available: ${colors.dim}${currentVersion}${colors.reset} → ${colors.green}${latestVersion}${colors.reset}`, 39)}${colors.dim}│${colors.reset}`);
  console.log(`${colors.dim}│${colors.reset} ${pad(`Run ${colors.bold}lore update${colors.reset} to upgrade`, 39)}${colors.dim}│${colors.reset}`);
  console.log(bottom);

  // Mark as notified
  writeCache({
    last_check: cache?.last_check || now,
    latest_version: latestVersion,
    last_notified_version: latestVersion,
  });
}
