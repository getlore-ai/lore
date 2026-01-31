/**
 * Local Search - Regex/pattern search in local source files
 *
 * Provides grep-like functionality for searching source content
 * stored in the data directory. Tries ripgrep first for speed,
 * falls back to native JavaScript regex.
 */

import { spawn } from 'child_process';
import { readdir, readFile } from 'fs/promises';
import path from 'path';
import { existsSync } from 'fs';

export interface LocalSearchMatch {
  line_number: number;
  line_content: string;
  match_start: number;
  match_end: number;
}

export interface LocalSearchResult {
  source_id: string;
  file_path: string;
  matches: LocalSearchMatch[];
}

export interface LocalSearchOptions {
  /** Maximum results per file */
  maxMatchesPerFile?: number;
  /** Maximum total results */
  maxTotalResults?: number;
  /** Case-insensitive search */
  ignoreCase?: boolean;
  /** Lines of context before match */
  contextBefore?: number;
  /** Lines of context after match */
  contextAfter?: number;
}

/**
 * Check if ripgrep is available
 */
async function hasRipgrep(): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn('rg', ['--version']);
    proc.on('error', () => resolve(false));
    proc.on('close', (code) => resolve(code === 0));
  });
}

/**
 * Search using ripgrep (fast)
 */
async function searchWithRipgrep(
  sourcesDir: string,
  pattern: string,
  options: LocalSearchOptions
): Promise<LocalSearchResult[]> {
  const {
    maxMatchesPerFile = 10,
    maxTotalResults = 100,
    ignoreCase = false,
    contextBefore = 0,
    contextAfter = 0,
  } = options;

  return new Promise((resolve, reject) => {
    const args = [
      '--json',
      '--max-count', String(maxMatchesPerFile),
      '--glob', 'content.md',
    ];

    if (ignoreCase) {
      args.push('--ignore-case');
    }

    if (contextBefore > 0) {
      args.push('-B', String(contextBefore));
    }

    if (contextAfter > 0) {
      args.push('-A', String(contextAfter));
    }

    args.push(pattern, sourcesDir);

    const proc = spawn('rg', args);
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('error', (err) => {
      reject(err);
    });

    proc.on('close', (code) => {
      // ripgrep returns 1 if no matches, 0 if matches, 2 if error
      if (code === 2) {
        reject(new Error(`ripgrep error: ${stderr}`));
        return;
      }

      const results: LocalSearchResult[] = [];
      const resultMap = new Map<string, LocalSearchResult>();

      // Parse JSON lines output
      const lines = stdout.split('\n').filter((l) => l.trim());

      for (const line of lines) {
        try {
          const entry = JSON.parse(line);

          if (entry.type === 'match') {
            const filePath = entry.data.path.text;
            // Extract source_id from path (e.g., /path/sources/{source_id}/content.md)
            const parts = filePath.split(path.sep);
            const contentIdx = parts.findIndex((p: string) => p === 'content.md');
            const sourceId = contentIdx > 0 ? parts[contentIdx - 1] : path.basename(path.dirname(filePath));

            let result = resultMap.get(sourceId);
            if (!result) {
              result = {
                source_id: sourceId,
                file_path: filePath,
                matches: [],
              };
              resultMap.set(sourceId, result);
            }

            // Process submatches
            for (const submatch of entry.data.submatches || []) {
              result.matches.push({
                line_number: entry.data.line_number,
                line_content: entry.data.lines.text.replace(/\n$/, ''),
                match_start: submatch.start,
                match_end: submatch.end,
              });
            }
          }
        } catch {
          // Skip invalid JSON lines
        }
      }

      // Convert map to array and limit total results
      for (const result of resultMap.values()) {
        if (results.length >= maxTotalResults) break;
        results.push(result);
      }

      resolve(results);
    });
  });
}

/**
 * Search using native JavaScript regex (fallback)
 */
async function searchWithNative(
  sourcesDir: string,
  pattern: string,
  options: LocalSearchOptions
): Promise<LocalSearchResult[]> {
  const {
    maxMatchesPerFile = 10,
    maxTotalResults = 100,
    ignoreCase = false,
  } = options;

  const results: LocalSearchResult[] = [];

  // Create regex
  let regex: RegExp;
  try {
    regex = new RegExp(pattern, ignoreCase ? 'gi' : 'g');
  } catch (err) {
    throw new Error(`Invalid regex pattern: ${pattern}`);
  }

  // Read all source directories
  if (!existsSync(sourcesDir)) {
    return [];
  }

  const entries = await readdir(sourcesDir, { withFileTypes: true });

  for (const entry of entries) {
    if (results.length >= maxTotalResults) break;

    if (!entry.isDirectory()) continue;

    const contentPath = path.join(sourcesDir, entry.name, 'content.md');
    if (!existsSync(contentPath)) continue;

    try {
      const content = await readFile(contentPath, 'utf-8');
      const lines = content.split('\n');
      const matches: LocalSearchMatch[] = [];

      for (let i = 0; i < lines.length && matches.length < maxMatchesPerFile; i++) {
        const line = lines[i];
        regex.lastIndex = 0; // Reset regex state

        let match;
        while ((match = regex.exec(line)) !== null && matches.length < maxMatchesPerFile) {
          matches.push({
            line_number: i + 1,
            line_content: line,
            match_start: match.index,
            match_end: match.index + match[0].length,
          });

          // Prevent infinite loop on zero-length matches
          if (match[0].length === 0) {
            regex.lastIndex++;
          }
        }
      }

      if (matches.length > 0) {
        results.push({
          source_id: entry.name,
          file_path: contentPath,
          matches,
        });
      }
    } catch {
      // Skip files that can't be read
    }
  }

  return results;
}

/**
 * Search local source files using regex pattern
 *
 * @param dataDir - The lore data directory
 * @param pattern - Regex pattern to search for
 * @param options - Search options
 * @returns Array of search results with matches
 */
export async function searchLocalFiles(
  dataDir: string,
  pattern: string,
  options: LocalSearchOptions = {}
): Promise<LocalSearchResult[]> {
  const sourcesDir = path.join(dataDir, 'sources');

  if (!existsSync(sourcesDir)) {
    return [];
  }

  // Try ripgrep first, fall back to native
  const useRipgrep = await hasRipgrep();

  if (useRipgrep) {
    try {
      return await searchWithRipgrep(sourcesDir, pattern, options);
    } catch {
      // Fall back to native on error
      return await searchWithNative(sourcesDir, pattern, options);
    }
  }

  return await searchWithNative(sourcesDir, pattern, options);
}

/**
 * Get a snippet of text around a match for display
 */
export function getMatchSnippet(
  lineContent: string,
  matchStart: number,
  matchEnd: number,
  maxLength: number = 100
): string {
  const matchText = lineContent.slice(matchStart, matchEnd);

  // Calculate window around match
  const halfWindow = Math.floor((maxLength - matchText.length) / 2);
  let start = Math.max(0, matchStart - halfWindow);
  let end = Math.min(lineContent.length, matchEnd + halfWindow);

  // Adjust if we're near edges
  if (start === 0) {
    end = Math.min(lineContent.length, maxLength);
  } else if (end === lineContent.length) {
    start = Math.max(0, lineContent.length - maxLength);
  }

  let snippet = lineContent.slice(start, end);

  // Add ellipses
  if (start > 0) {
    snippet = '...' + snippet;
  }
  if (end < lineContent.length) {
    snippet = snippet + '...';
  }

  return snippet;
}
