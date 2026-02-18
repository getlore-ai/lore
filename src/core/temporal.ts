/**
 * Temporal utilities for time-aware search and filtering.
 *
 * Pure regex-based — no LLM calls, zero latency.
 */

export interface TemporalIntent {
  hasTemporalIntent: boolean;
  recencyBoost: number;
  sortByDate: boolean;
}

const TEMPORAL_PATTERNS = [
  /\brecent(ly)?\b/i,
  /\blatest\b/i,
  /\bnewest\b/i,
  /\blast\s+(week|month|few|couple)\b/i,
  /\bthis\s+(week|month)\b/i,
  /\btoday\b/i,
  /\byesterday\b/i,
  /\bmost\s+recent\b/i,
  /\bwhat'?s new\b/i,
  /\bany new\b/i,
  /\bpast\s+\d+\s*(days?|weeks?|months?)\b/i,
];

/**
 * Detect whether a query has temporal intent (e.g. "most recent interview").
 * Returns boosted recency params when detected.
 */
export function detectTemporalIntent(query: string): TemporalIntent {
  const hasTemporalIntent = TEMPORAL_PATTERNS.some((p) => p.test(query));
  return hasTemporalIntent
    ? { hasTemporalIntent: true, recencyBoost: 0.7, sortByDate: true }
    : { hasTemporalIntent: false, recencyBoost: 0.15, sortByDate: false };
}

/**
 * Parse a date argument from CLI flags or MCP params.
 *
 * Supports:
 * - ISO dates: "2025-06-01"
 * - Relative shorthand: "7d", "2w", "1m", "3m"
 * - Natural language: "last week", "last month"
 *
 * Returns an ISO date string or null on failure.
 */
export function parseDateArg(value: string): string | null {
  if (!value) return null;
  const trimmed = value.trim().toLowerCase();

  // ISO date (YYYY-MM-DD or full ISO)
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    const d = new Date(trimmed);
    if (!isNaN(d.getTime())) return d.toISOString();
    return null;
  }

  const now = new Date();

  // Relative shorthand: 7d, 2w, 1m, 3m
  const relMatch = trimmed.match(/^(\d+)\s*(d|w|m)$/);
  if (relMatch) {
    const n = parseInt(relMatch[1], 10);
    const unit = relMatch[2];
    if (unit === 'd') now.setDate(now.getDate() - n);
    else if (unit === 'w') now.setDate(now.getDate() - n * 7);
    else if (unit === 'm') now.setMonth(now.getMonth() - n);
    return now.toISOString();
  }

  // Natural language
  if (trimmed === 'last week') {
    now.setDate(now.getDate() - 7);
    return now.toISOString();
  }
  if (trimmed === 'last month') {
    now.setMonth(now.getMonth() - 1);
    return now.toISOString();
  }
  if (trimmed === 'today') {
    now.setHours(0, 0, 0, 0);
    return now.toISOString();
  }
  if (trimmed === 'yesterday') {
    now.setDate(now.getDate() - 1);
    now.setHours(0, 0, 0, 0);
    return now.toISOString();
  }

  return null;
}

/**
 * Post-filter an array of results by date range.
 * Items must have a `created_at` string field.
 */
export function filterByDateRange<T extends { created_at: string }>(
  results: T[],
  since?: string | null,
  before?: string | null
): T[] {
  const sinceTime = since ? new Date(since).getTime() : null;
  const beforeTime = before ? new Date(before).getTime() : null;

  if (!sinceTime && !beforeTime) return results;

  return results.filter((r) => {
    const t = new Date(r.created_at).getTime();
    if (sinceTime && t < sinceTime) return false;
    if (beforeTime && t > beforeTime) return false;
    return true;
  });
}

/**
 * Sort results by created_at descending (newest first).
 */
export function sortByRecency<T extends { created_at: string }>(results: T[]): T[] {
  return [...results].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
}

/**
 * Format a date string for display (e.g. "Feb 17, 2026").
 */
export function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return dateStr;
  }
}
