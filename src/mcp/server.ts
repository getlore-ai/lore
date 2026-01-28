#!/usr/bin/env node

/**
 * Lore - MCP Server
 *
 * Exposes knowledge repository tools via Model Context Protocol.
 * Supports both simple query tools and agentic research capabilities.
 *
 * Auto-syncs: Periodically checks for new sources and syncs them.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import { readdir } from 'fs/promises';
import path from 'path';

import { toolDefinitions } from './tools.js';
import { handleSearch } from './handlers/search.js';
import { handleGetSource } from './handlers/get-source.js';
import { handleListSources } from './handlers/list-sources.js';
import { handleGetQuotes } from './handlers/get-quotes.js';
import { handleRetain } from './handlers/retain.js';
import { handleIngest } from './handlers/ingest.js';
import { handleResearch } from './handlers/research.js';
import { handleListProjects } from './handlers/list-projects.js';
import { handleSync } from './handlers/sync.js';
import { handleArchiveProject } from './handlers/archive-project.js';
import { indexExists, getAllSources } from '../core/vector-store.js';

const execAsync = promisify(exec);

// Configuration from environment
const LORE_DATA_DIR = process.env.LORE_DATA_DIR || './data';
const DB_PATH = path.join(LORE_DATA_DIR, 'lore.lance');
const SYNC_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const AUTO_GIT_PULL = process.env.LORE_AUTO_GIT_PULL !== 'false';
const AUTO_GIT_PUSH = process.env.LORE_AUTO_GIT_PUSH !== 'false';
const AUTO_INDEX = process.env.LORE_AUTO_INDEX !== 'false'; // Auto-index new sources (costs API calls)

/**
 * Try to git pull, handling conflicts gracefully
 */
async function tryGitPull(): Promise<{ pulled: boolean; error?: string }> {
  try {
    // Check if we're in a git repo
    await execAsync('git rev-parse --git-dir', { cwd: LORE_DATA_DIR });

    // Stash any local changes (shouldn't be any, but just in case)
    await execAsync('git stash', { cwd: LORE_DATA_DIR }).catch(() => {});

    // Pull with rebase to avoid merge commits
    const { stdout } = await execAsync('git pull --rebase', { cwd: LORE_DATA_DIR });

    const pulled = !stdout.includes('Already up to date');
    return { pulled };
  } catch (error) {
    // Not a git repo or pull failed - that's okay, continue without sync
    return { pulled: false, error: String(error) };
  }
}

/**
 * Find sources on disk that aren't in the index
 */
async function findUnsyncedSources(): Promise<string[]> {
  const sourcesDir = path.join(LORE_DATA_DIR, 'sources');

  try {
    // Get source IDs from disk
    const diskSources = await readdir(sourcesDir, { withFileTypes: true });
    const diskIds = diskSources
      .filter(d => d.isDirectory() && !d.name.startsWith('.'))
      .map(d => d.name);

    // Get source IDs from index
    const indexedSources = await getAllSources(DB_PATH, {});
    const indexedIds = new Set(indexedSources.map(s => s.id));

    // Find the difference
    return diskIds.filter(id => !indexedIds.has(id));
  } catch {
    return [];
  }
}

/**
 * Periodic sync check
 */
async function syncCheck(): Promise<void> {
  try {
    // Use the sync handler for actual sync
    const result = await handleSync(DB_PATH, LORE_DATA_DIR, {
      git_pull: AUTO_GIT_PULL,
      index_new: AUTO_INDEX,
    });

    if (result.git_pulled) {
      console.error('[lore] Git pulled new changes');
    }

    if (result.sources_indexed > 0) {
      console.error(`[lore] Auto-indexed ${result.sources_indexed} new source(s)`);
    } else if (!AUTO_INDEX) {
      // Check for unsynced without indexing
      const unsynced = await findUnsyncedSources();
      if (unsynced.length > 0) {
        console.error(`[lore] Found ${unsynced.length} unsynced sources. Use 'sync' tool or set LORE_AUTO_INDEX=true.`);
      }
    }
  } catch (error) {
    console.error('[lore] Sync check error:', error);
  }
}

async function main() {
  // Check if index exists
  const hasIndex = await indexExists(DB_PATH);
  if (!hasIndex) {
    console.error(`[lore] No index found at ${DB_PATH}. Run 'lore ingest' to add sources.`);
  }

  // Initial sync check
  await syncCheck();

  // Periodic sync check
  setInterval(syncCheck, SYNC_INTERVAL_MS);
  console.error(`[lore] Auto-sync enabled (every ${SYNC_INTERVAL_MS / 60000} minutes)`);

  const server = new Server(
    {
      name: 'lore',
      version: '0.1.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // List available tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: toolDefinitions };
  });

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      let result: unknown;

      switch (name) {
        // Simple query tools (cheap, fast)
        case 'search':
          result = await handleSearch(DB_PATH, LORE_DATA_DIR, args as any);
          break;

        case 'get_source':
          result = await handleGetSource(DB_PATH, LORE_DATA_DIR, args as any);
          break;

        case 'list_sources':
          result = await handleListSources(DB_PATH, args as any);
          break;

        case 'get_quotes':
          result = await handleGetQuotes(DB_PATH, args as any);
          break;

        case 'list_projects':
          result = await handleListProjects(DB_PATH);
          break;

        // Push-based retention
        case 'retain':
          result = await handleRetain(DB_PATH, LORE_DATA_DIR, args as any, {
            autoPush: AUTO_GIT_PUSH,
          });
          break;

        // Direct document ingestion
        case 'ingest':
          result = await handleIngest(DB_PATH, LORE_DATA_DIR, args as any, {
            autoPush: AUTO_GIT_PUSH,
          });
          break;

        // Agentic research tool (uses Claude Agent SDK internally)
        case 'research':
          result = await handleResearch(DB_PATH, LORE_DATA_DIR, args as any);
          break;

        // Sync tool
        case 'sync':
          result = await handleSync(DB_PATH, LORE_DATA_DIR, args as any);
          break;

        // Project management
        case 'archive_project':
          result = await handleArchiveProject(DB_PATH, LORE_DATA_DIR, args as any, {
            autoPush: AUTO_GIT_PUSH,
          });
          break;

        default:
          throw new Error(`Unknown tool: ${name}`);
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ error: errorMessage }),
          },
        ],
        isError: true,
      };
    }
  });

  // Start server
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error('Lore server error:', error);
  process.exit(1);
});
