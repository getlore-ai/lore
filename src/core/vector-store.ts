/**
 * Lore - Vector Store (Supabase + pgvector)
 *
 * Cloud-hosted vector storage for semantic search across sources and chunks.
 * Replaces LanceDB for multi-machine, multi-agent support.
 *
 * This barrel re-exports from focused sub-modules.
 */

export * from './vector-store-client.js';
export * from './vector-store-write.js';
export * from './vector-store-lookup.js';
export * from './vector-store-search.js';
export * from './vector-store-retrieval.js';
export * from './vector-store-stats.js';
