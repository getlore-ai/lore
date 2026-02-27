/**
 * Vector Store - Write Operations
 *
 * Adding and storing sources in Supabase.
 */

import type { SourceRecord } from './types.js';
import { getSupabase } from './vector-store-client.js';

export async function addSource(
  _dbPath: string,
  source: SourceRecord,
  vector: number[],
  extras?: {
    content_hash?: string;
    source_path?: string;
    source_url?: string;
    source_name?: string;
    content?: string;
    content_size?: number;
  }
): Promise<void> {
  const client = await getSupabase();

  const record: Record<string, unknown> = {
    id: source.id,
    title: source.title,
    source_type: source.source_type,
    content_type: source.content_type,
    projects: JSON.parse(source.projects),
    tags: JSON.parse(source.tags),
    created_at: source.created_at,
    summary: source.summary,
    themes_json: JSON.parse(source.themes_json),
    quotes_json: JSON.parse(source.quotes_json),
    has_full_content: source.has_full_content,
    embedding: vector,
    indexed_at: new Date().toISOString(),
  };

  // Add optional dedup and metadata fields
  if (extras?.content_hash) {
    record.content_hash = extras.content_hash;
  }
  if (extras?.source_path) {
    record.source_path = extras.source_path;
  }
  if (extras?.source_url) {
    record.source_url = extras.source_url;
  }
  if (extras?.source_name) {
    record.source_name = extras.source_name;
  }
  if (extras?.content) {
    const size = extras.content_size ?? Buffer.byteLength(extras.content, 'utf-8');
    // Skip content storage for documents exceeding 500KB (Supabase payload limit)
    if (size <= 500 * 1024) {
      record.content = extras.content;
      record.content_size = size;
    }
  }

  const { error } = await client.from('sources').upsert(record);

  if (error) {
    // Duplicate content_hash for this user — document already exists, skip silently
    if (error.code === '23505') {
      return;
    }
    console.error('[addSource] Error:', error);
    throw error;
  }
}

export async function storeSources(
  _dbPath: string,
  sources: Array<{
    source: SourceRecord;
    vector: number[];
    extras?: {
      content_hash?: string;
      source_path?: string;
      source_url?: string;
      source_name?: string;
      content?: string;
      content_size?: number;
    };
  }>
): Promise<void> {
  const client = await getSupabase();

  const records = sources.map(({ source, vector, extras }) => {
    const record: Record<string, unknown> = {
      id: source.id,
      title: source.title,
      source_type: source.source_type,
      content_type: source.content_type,
      projects: JSON.parse(source.projects),
      tags: JSON.parse(source.tags),
      created_at: source.created_at,
      summary: source.summary,
      themes_json: JSON.parse(source.themes_json),
      quotes_json: JSON.parse(source.quotes_json),
      has_full_content: source.has_full_content,
      embedding: vector,
      indexed_at: new Date().toISOString(),
    };

    if (extras?.content_hash) {
      record.content_hash = extras.content_hash;
    }
    if (extras?.source_path) {
      record.source_path = extras.source_path;
    }
    if (extras?.source_url) {
      record.source_url = extras.source_url;
    }
    if (extras?.source_name) {
      record.source_name = extras.source_name;
    }
    if (extras?.content) {
      const size = extras.content_size ?? Buffer.byteLength(extras.content, 'utf-8');
      if (size <= 500 * 1024) {
        record.content = extras.content;
        record.content_size = size;
      }
    }

    return record;
  });

  const { error } = await client.from('sources').upsert(records, {
    onConflict: 'id',
    ignoreDuplicates: false,
  });

  if (error) {
    // If batch fails due to duplicate content_hash, fall back to individual upserts
    if (error.code === '23505') {
      const failures: unknown[] = [];
      for (const record of records) {
        const { error: singleError } = await client.from('sources').upsert(record);
        if (singleError && singleError.code !== '23505') {
          console.error('[storeSources] Error upserting single record:', singleError);
          failures.push(singleError);
        }
      }
      if (failures.length > 0) {
        const first = failures[0] as { message?: string };
        throw new Error(first?.message || 'Unknown storeSources error');
      }
      return;
    }
    console.error('[storeSources] Error:', error);
    throw error;
  }
}
