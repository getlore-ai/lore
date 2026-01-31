/**
 * Lore - File Discovery (Phase 1)
 *
 * Discovers files from configured sources, computes content hashes,
 * and checks against Supabase for deduplication.
 *
 * NO LLM calls in this phase - it's essentially free to run.
 */

import { readFile, readdir, stat } from 'fs/promises';
import { createHash } from 'crypto';
import path from 'path';
import { existsSync } from 'fs';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

import type { SyncSource } from './config.js';
import { expandPath } from './config.js';
import { getSourcePathMappings } from '../core/vector-store.js';

// ============================================================================
// Types
// ============================================================================

export interface DiscoveredFile {
  absolutePath: string;   // Full path on disk
  relativePath: string;   // Relative to source directory
  contentHash: string;    // SHA256 of raw file content
  size: number;           // File size in bytes
  modifiedAt: Date;       // Last modified time
  sourceName: string;     // Name of the SyncSource
  project: string;        // Project from SyncSource
  existingId?: string;    // If this is an edit, the existing source ID
}

export interface DiscoveryResult {
  source: SyncSource;
  totalFiles: number;
  newFiles: DiscoveredFile[];
  editedFiles: DiscoveredFile[];  // Files with same path but different hash
  existingFiles: number;
  errors: string[];
}

// ============================================================================
// Hash Computation
// ============================================================================

export async function computeFileHash(filePath: string): Promise<string> {
  const content = await readFile(filePath);
  return createHash('sha256').update(content).digest('hex');
}

// ============================================================================
// Glob Matching
// ============================================================================

/**
 * Simple glob pattern matching for common patterns:
 * - "**\/*.md" - any .md file in any subdirectory
 * - "*.md" - .md files in root only
 * - "**\/*.{md,pdf}" - multiple extensions
 */
export function matchesGlob(relativePath: string, glob: string): boolean {
  // Handle {ext1,ext2} extension lists
  const extensionMatch = glob.match(/\.\{([^}]+)\}$/);
  if (extensionMatch) {
    const extensions = extensionMatch[1].split(',');
    const baseGlob = glob.replace(/\.\{[^}]+\}$/, '');
    return extensions.some(ext =>
      matchesGlob(relativePath, `${baseGlob}.${ext}`)
    );
  }

  // Convert glob to regex
  // Important: Replace glob wildcards BEFORE inserting regex patterns with special chars
  let pattern = glob
    .replace(/\?/g, '.')                          // ? matches single char (do first!)
    .replace(/\*\*\//g, '{{DOUBLE_STAR_SLASH}}')  // Placeholder for **/
    .replace(/\*\*/g, '{{DOUBLE_STAR}}')          // Placeholder for ** (without trailing /)
    .replace(/\*/g, '[^/]*')                      // * matches anything except /
    .replace(/{{DOUBLE_STAR_SLASH}}/g, '(.*\\/)?') // **/ matches any path including empty
    .replace(/{{DOUBLE_STAR}}/g, '.*');           // ** matches anything including /

  // Anchor the pattern
  const regex = new RegExp(`^${pattern}$`);
  return regex.test(relativePath);
}

// ============================================================================
// File Discovery
// ============================================================================

async function discoverFilesRecursive(
  dir: string,
  baseDir: string,
  glob: string,
  results: { path: string; relativePath: string }[]
): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relativePath = path.relative(baseDir, fullPath);

    if (entry.isDirectory()) {
      // Skip hidden directories and common non-content dirs
      if (entry.name.startsWith('.') ||
          entry.name === 'node_modules' ||
          entry.name === '__pycache__') {
        continue;
      }
      await discoverFilesRecursive(fullPath, baseDir, glob, results);
    } else if (entry.isFile()) {
      // Check if file matches glob pattern
      if (matchesGlob(relativePath, glob)) {
        results.push({ path: fullPath, relativePath });
      }
    }
  }
}

// ============================================================================
// Supabase Deduplication
// ============================================================================

let supabase: SupabaseClient | null = null;

function getSupabase(): SupabaseClient {
  if (!supabase) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

    if (!url || !key) {
      throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY (or SUPABASE_ANON_KEY) are required');
    }

    supabase = createClient(url, key);
  }
  return supabase;
}

export async function checkExistingHashes(
  hashes: string[]
): Promise<Set<string>> {
  if (hashes.length === 0) return new Set();

  const client = getSupabase();
  const existing = new Set<string>();

  // Query in batches to avoid hitting limits
  const batchSize = 100;
  for (let i = 0; i < hashes.length; i += batchSize) {
    const batch = hashes.slice(i, i + batchSize);

    const { data, error } = await client
      .from('sources')
      .select('content_hash')
      .in('content_hash', batch);

    if (error) {
      console.error('[discover] Error checking existing hashes:', error);
      continue;
    }

    for (const row of data || []) {
      if (row.content_hash) {
        existing.add(row.content_hash);
      }
    }
  }

  return existing;
}

// ============================================================================
// Main Discovery Function
// ============================================================================

export async function discoverSource(
  source: SyncSource,
  options: {
    onProgress?: (found: number, checked: number) => void;
  } = {}
): Promise<DiscoveryResult> {
  const { onProgress } = options;
  const expandedPath = expandPath(source.path);

  const result: DiscoveryResult = {
    source,
    totalFiles: 0,
    newFiles: [],
    editedFiles: [],
    existingFiles: 0,
    errors: [],
  };

  // Check if source directory exists
  if (!existsSync(expandedPath)) {
    result.errors.push(`Directory not found: ${expandedPath}`);
    return result;
  }

  // Discover all matching files
  const matchingFiles: { path: string; relativePath: string }[] = [];
  try {
    await discoverFilesRecursive(expandedPath, expandedPath, source.glob, matchingFiles);
  } catch (error) {
    result.errors.push(`Error scanning directory: ${error}`);
    return result;
  }

  result.totalFiles = matchingFiles.length;

  if (matchingFiles.length === 0) {
    return result;
  }

  // Compute hashes for all files
  const filesWithHashes: DiscoveredFile[] = [];

  for (let i = 0; i < matchingFiles.length; i++) {
    const file = matchingFiles[i];

    try {
      const fileStat = await stat(file.path);
      const contentHash = await computeFileHash(file.path);

      filesWithHashes.push({
        absolutePath: file.path,
        relativePath: file.relativePath,
        contentHash,
        size: fileStat.size,
        modifiedAt: fileStat.mtime,
        sourceName: source.name,
        project: source.project,
      });

      onProgress?.(filesWithHashes.length, matchingFiles.length);
    } catch (error) {
      result.errors.push(`Error processing ${file.path}: ${error}`);
    }
  }

  // Check which hashes already exist in Supabase (unchanged files)
  const allHashes = filesWithHashes.map(f => f.contentHash);
  const existingHashes = await checkExistingHashes(allHashes);

  // Check which paths already exist in Supabase (for edit detection)
  const allPaths = filesWithHashes.map(f => f.absolutePath);
  const pathMappings = await getSourcePathMappings('', allPaths);

  // Categorize files: existing (unchanged), edited, or new
  for (const file of filesWithHashes) {
    if (existingHashes.has(file.contentHash)) {
      // Content hash matches - file is unchanged
      result.existingFiles++;
    } else {
      // Content is different - check if path exists (edit) or not (new)
      const existingSource = pathMappings.get(file.absolutePath);
      if (existingSource) {
        // Same path, different hash = edit
        file.existingId = existingSource.id;
        result.editedFiles.push(file);
      } else {
        // New path = new file
        result.newFiles.push(file);
      }
    }
  }

  return result;
}

export async function discoverAllSources(
  sources: SyncSource[],
  options: {
    onSourceStart?: (source: SyncSource) => void;
    onSourceComplete?: (result: DiscoveryResult) => void;
  } = {}
): Promise<DiscoveryResult[]> {
  const { onSourceStart, onSourceComplete } = options;
  const results: DiscoveryResult[] = [];

  for (const source of sources) {
    if (!source.enabled) continue;

    onSourceStart?.(source);
    const result = await discoverSource(source);
    onSourceComplete?.(result);
    results.push(result);
  }

  return results;
}

// ============================================================================
// Summary Statistics
// ============================================================================

export function summarizeDiscovery(results: DiscoveryResult[]): {
  totalSources: number;
  totalFiles: number;
  newFiles: number;
  editedFiles: number;
  existingFiles: number;
  errors: number;
} {
  return {
    totalSources: results.length,
    totalFiles: results.reduce((sum, r) => sum + r.totalFiles, 0),
    newFiles: results.reduce((sum, r) => sum + r.newFiles.length, 0),
    editedFiles: results.reduce((sum, r) => sum + r.editedFiles.length, 0),
    existingFiles: results.reduce((sum, r) => sum + r.existingFiles, 0),
    errors: results.reduce((sum, r) => sum + r.errors.length, 0),
  };
}
