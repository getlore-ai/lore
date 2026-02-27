/**
 * Blocklist — prevents re-indexing of deleted sources.
 *
 * Stores content hashes of deleted sources in lore-data/deleted-hashes.json.
 * This file is git-tracked so deletions propagate across machines.
 */

import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

const BLOCKLIST_FILENAME = 'deleted-hashes.json';

function blocklistPath(dataDir: string): string {
  return path.join(dataDir, BLOCKLIST_FILENAME);
}

/**
 * Load the set of blocked content hashes.
 */
export async function loadBlocklist(dataDir: string): Promise<Set<string>> {
  const filePath = blocklistPath(dataDir);
  if (!existsSync(filePath)) return new Set();

  try {
    const raw = await readFile(filePath, 'utf-8');
    const hashes: string[] = JSON.parse(raw);
    return new Set(hashes);
  } catch {
    return new Set();
  }
}

/**
 * Add one or more content hashes to the blocklist.
 * Skips null/undefined values.
 */
export async function addToBlocklist(
  dataDir: string,
  ...hashes: (string | undefined | null)[]
): Promise<void> {
  const existing = await loadBlocklist(dataDir);
  let changed = false;

  for (const hash of hashes) {
    if (hash && !existing.has(hash)) {
      existing.add(hash);
      changed = true;
    }
  }

  if (!changed) return;

  const filePath = blocklistPath(dataDir);
  await writeFile(filePath, JSON.stringify([...existing], null, 2) + '\n');
}

/**
 * Remove a content hash from the blocklist (e.g. when restoring a soft-deleted source).
 */
export async function removeFromBlocklist(
  dataDir: string,
  hash: string
): Promise<void> {
  const existing = await loadBlocklist(dataDir);
  if (!existing.has(hash)) return;

  existing.delete(hash);

  const filePath = blocklistPath(dataDir);
  if (existing.size === 0) {
    await writeFile(filePath, '[]\n');
  } else {
    await writeFile(filePath, JSON.stringify([...existing], null, 2) + '\n');
  }
}
