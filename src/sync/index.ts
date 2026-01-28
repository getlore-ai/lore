/**
 * Lore - Universal Sync Module
 *
 * Two-phase sync system:
 * 1. Discovery: Find files, compute hashes, check for duplicates
 * 2. Processing: Claude extracts metadata, generates embeddings, stores
 */

export * from './config.js';
export * from './discover.js';
export * from './processors.js';
export * from './process.js';
