/**
 * Source Path Management
 *
 * Human-friendly directory layout for source documents:
 *   sources/{project}/{YYYY-MM-DD}-{slug}-{8-char-uuid}/
 *
 * Provides:
 * - slugify() — title to URL-safe slug
 * - computeSourcePath() — deterministic relative path from metadata
 * - resolveSourceDir() — UUID → absolute directory (index → legacy fallback)
 * - Path index (.paths.json) for fast UUID → path lookups
 */

import { readFile, writeFile, readdir, stat } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

// ============================================================================
// Slugify
// ============================================================================

/**
 * Convert a title to a URL-safe slug.
 * Lowercase, alphanumeric + hyphens, truncated at word boundary.
 */
export function slugify(title: string, maxLength = 50): string {
  let slug = title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip diacritics
    .replace(/[^a-z0-9\s-]/g, '')    // remove non-alphanumeric
    .replace(/\s+/g, '-')            // spaces → hyphens
    .replace(/-+/g, '-')             // collapse multiple hyphens
    .replace(/^-|-$/g, '');          // trim leading/trailing hyphens

  if (slug.length > maxLength) {
    // Truncate at last hyphen before maxLength (word boundary)
    slug = slug.substring(0, maxLength);
    const lastHyphen = slug.lastIndexOf('-');
    if (lastHyphen > maxLength * 0.5) {
      slug = slug.substring(0, lastHyphen);
    }
  }

  return slug || 'untitled';
}

// ============================================================================
// Path Computation
// ============================================================================

/**
 * Compute the relative path for a source directory.
 * Returns path relative to the `sources/` directory.
 *
 * Format: {project}/{YYYY-MM-DD}-{slug}-{8-char-uuid}
 */
/**
 * Sanitize a project name for use as a safe single path segment.
 * Strips path separators, dots, and other traversal-unsafe characters.
 */
function sanitizeProject(project: string): string {
  return project
    .toLowerCase()
    .replace(/[/\\]/g, '-')       // path separators → hyphens
    .replace(/\.{2,}/g, '')       // remove .. sequences
    .replace(/^\.+|\.+$/g, '')    // strip leading/trailing dots
    .replace(/[^a-z0-9._-]/g, '-') // keep only safe chars
    .replace(/-+/g, '-')          // collapse hyphens
    .replace(/^-|-$/g, '')        // trim hyphens
    || 'uncategorized';
}

export function computeSourcePath(
  project: string,
  title: string,
  createdAt: string,
  id: string
): string {
  const date = createdAt.substring(0, 10); // YYYY-MM-DD
  const slug = slugify(title);
  const shortId = id.substring(0, 8);
  const dirName = `${date}-${slug}-${shortId}`;
  return path.join(sanitizeProject(project), dirName);
}

// ============================================================================
// Path Index (.paths.json)
// ============================================================================

type PathIndex = Record<string, string>; // UUID → relative path

let cachedIndex: PathIndex | null = null;
let cachedIndexPath: string | null = null;

function indexPath(dataDir: string): string {
  return path.join(dataDir, 'sources', '.paths.json');
}

/**
 * Load the path index from disk. Returns cached version if available.
 */
export async function loadPathIndex(dataDir: string): Promise<PathIndex> {
  const fp = indexPath(dataDir);
  if (cachedIndex && cachedIndexPath === fp) {
    return { ...cachedIndex };
  }

  try {
    const content = await readFile(fp, 'utf-8');
    cachedIndex = JSON.parse(content) as PathIndex;
    cachedIndexPath = fp;
    return { ...cachedIndex };
  } catch {
    cachedIndex = {};
    cachedIndexPath = fp;
    return { ...cachedIndex };
  }
}

/**
 * Save the path index to disk and update cache.
 */
export async function savePathIndex(dataDir: string, index: PathIndex): Promise<void> {
  const fp = indexPath(dataDir);
  await writeFile(fp, JSON.stringify(index, null, 2) + '\n');
  cachedIndex = { ...index }; // snapshot to prevent external mutation of cache
  cachedIndexPath = fp;
}

// Serialize index writes to prevent concurrent read-modify-write races.
// Each write waits for the previous one to complete before proceeding.
let writeQueue: Promise<void> = Promise.resolve();

/**
 * Add a single entry to the path index.
 * Serialized to prevent concurrent writes from dropping entries.
 */
export async function addToPathIndex(dataDir: string, id: string, relativePath: string): Promise<void> {
  const op = writeQueue.then(async () => {
    clearPathIndexCache(); // force re-read from disk
    const index = await loadPathIndex(dataDir);
    index[id] = relativePath;
    await savePathIndex(dataDir, index);
  });
  writeQueue = op.catch(() => {}); // prevent unhandled rejection from blocking queue
  return op;
}

/**
 * Remove a single entry from the path index.
 * Serialized to prevent concurrent writes from dropping entries.
 */
export async function removeFromPathIndex(dataDir: string, id: string): Promise<void> {
  const op = writeQueue.then(async () => {
    clearPathIndexCache(); // force re-read from disk
    const index = await loadPathIndex(dataDir);
    if (id in index) {
      delete index[id];
      await savePathIndex(dataDir, index);
    }
  });
  writeQueue = op.catch(() => {}); // prevent unhandled rejection from blocking queue
  return op;
}

/**
 * Add multiple entries to the path index in a single read-modify-write.
 * Much more efficient than calling addToPathIndex in a loop.
 */
export async function bulkAddToPathIndex(dataDir: string, entries: Record<string, string>): Promise<void> {
  if (Object.keys(entries).length === 0) return;
  const op = writeQueue.then(async () => {
    clearPathIndexCache();
    const index = await loadPathIndex(dataDir);
    Object.assign(index, entries);
    await savePathIndex(dataDir, index);
  });
  writeQueue = op.catch(() => {});
  return op;
}

// ============================================================================
// Path Resolution
// ============================================================================

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolve a source UUID to its absolute directory path.
 *
 * Resolution order:
 * 1. Check .paths.json index
 * 2. Fall back to legacy sources/{UUID}/ path
 * 3. If metadata provided (write path), compute new-format path and update index
 */
export async function resolveSourceDir(
  dataDir: string,
  id: string,
  metadata?: { project: string; title: string; createdAt: string }
): Promise<string> {
  const sourcesDir = path.join(dataDir, 'sources');

  // 1. Check path index
  const index = await loadPathIndex(dataDir);
  if (index[id]) {
    return path.join(sourcesDir, index[id]);
  }

  // 2. Legacy fallback — sources/{UUID}/
  const legacyDir = path.join(sourcesDir, id);
  if (existsSync(legacyDir)) {
    return legacyDir;
  }

  // 3. Compute from metadata (write path)
  if (metadata) {
    const relativePath = computeSourcePath(metadata.project, metadata.title, metadata.createdAt, id);
    // Don't update index here — caller should call addToPathIndex after mkdir
    return path.join(sourcesDir, relativePath);
  }

  // Default: return legacy path (may not exist yet)
  return legacyDir;
}

// ============================================================================
// Index Rebuild (repair tool)
// ============================================================================

/**
 * Rebuild .paths.json by scanning disk.
 * Handles both new-format (project/date-slug-uuid/) and legacy (UUID/) directories.
 */
export async function rebuildPathIndex(dataDir: string): Promise<{ total: number; newFormat: number; legacy: number }> {
  const sourcesDir = path.join(dataDir, 'sources');
  const index: PathIndex = {};
  let newFormat = 0;
  let legacy = 0;

  if (!existsSync(sourcesDir)) {
    await savePathIndex(dataDir, index);
    return { total: 0, newFormat: 0, legacy: 0 };
  }

  const topEntries = await readdir(sourcesDir, { withFileTypes: true });

  for (const entry of topEntries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;

    if (UUID_PATTERN.test(entry.name)) {
      // Legacy UUID directory — don't add to index (will be found via fallback)
      legacy++;
      continue;
    }

    // Project directory — scan one level deeper
    const projectDir = path.join(sourcesDir, entry.name);
    try {
      const subEntries = await readdir(projectDir, { withFileTypes: true });
      for (const sub of subEntries) {
        if (!sub.isDirectory() || sub.name.startsWith('.')) continue;

        // Extract UUID from dir name suffix (last 8 chars)
        // Format: YYYY-MM-DD-slug-{8-char-uuid}
        const shortId = sub.name.slice(-8);
        if (!/^[0-9a-f]{8}$/i.test(shortId)) continue;

        // Read metadata.json to get full UUID
        const metadataPath = path.join(projectDir, sub.name, 'metadata.json');
        try {
          const metaContent = await readFile(metadataPath, 'utf-8');
          const meta = JSON.parse(metaContent);
          if (meta.id) {
            index[meta.id] = path.join(entry.name, sub.name);
            newFormat++;
          }
        } catch {
          // Skip directories without valid metadata
        }
      }
    } catch {
      // Skip unreadable project directories
    }
  }

  await savePathIndex(dataDir, index);
  return { total: newFormat + legacy, newFormat, legacy };
}

/**
 * Extract the UUID from a source directory name.
 * Works with both new format (date-slug-{8-char}) and legacy (full UUID).
 */
export function extractIdFromDirName(dirName: string): string | null {
  if (UUID_PATTERN.test(dirName)) {
    return dirName;
  }
  // New format: last 8 chars are the UUID prefix
  const shortId = dirName.slice(-8);
  if (/^[0-9a-f]{8}$/i.test(shortId)) {
    return shortId; // Just the prefix — caller needs index to get full UUID
  }
  return null;
}

/**
 * Clear the in-memory path index cache.
 * Useful after external modifications to .paths.json.
 */
export function clearPathIndexCache(): void {
  cachedIndex = null;
  cachedIndexPath = null;
}
