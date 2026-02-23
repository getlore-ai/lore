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
import chokidar from 'chokidar';
import { readdir } from 'fs/promises';
import path from 'path';

import { toolDefinitions } from './tools.js';
import { handleSearch } from './handlers/search.js';
import { handleGetSource } from './handlers/get-source.js';
import { handleListSources } from './handlers/list-sources.js';
import { handleIngest } from './handlers/ingest.js';
import { handleResearch, startResearchJob, getResearchJobStatus } from './handlers/research.js';
import { handleListProjects } from './handlers/list-projects.js';
import { handleSync } from './handlers/sync.js';
import { handleArchiveProject } from './handlers/archive-project.js';
import { indexExists, getAllSources } from '../core/vector-store.js';
import { expandPath } from '../sync/config.js';
import { getExtensionRegistry } from '../extensions/registry.js';
import { getExtensionsDir } from '../extensions/config.js';
import { bridgeConfigToEnv } from '../core/config.js';

// Configuration from environment
const LORE_DATA_DIR = expandPath(process.env.LORE_DATA_DIR || '~/.lore');
const DB_PATH = path.join(LORE_DATA_DIR, 'lore.lance');
const SYNC_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// Auto-sync is DISABLED by default - use `lore watch` for visible sync
// Set LORE_AUTO_SYNC=true to enable background sync in MCP server
const AUTO_SYNC = process.env.LORE_AUTO_SYNC === 'true';
const AUTO_GIT_PULL = process.env.LORE_AUTO_GIT_PULL !== 'false';
const AUTO_GIT_PUSH = process.env.LORE_AUTO_GIT_PUSH !== 'false';
const AUTO_INDEX = process.env.LORE_AUTO_INDEX !== 'false';
const WATCH_EXTENSIONS =
  process.env.LORE_EXTENSION_WATCH === 'true' || process.argv.includes('--watch');

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
    const result = await handleSync(
      DB_PATH,
      LORE_DATA_DIR,
      {
        git_pull: AUTO_GIT_PULL,
        index_new: AUTO_INDEX,
      },
      { hookContext: { mode: 'mcp' } }
    );

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
  // Bridge config.json values into process.env (env vars take precedence)
  try {
    await bridgeConfigToEnv();
  } catch {
    // Config not set up yet — fine
  }

  // Check if index exists
  const hasIndex = await indexExists(DB_PATH);
  if (!hasIndex) {
    console.error(`[lore] No index found at ${DB_PATH}. Run 'lore ingest' to add sources.`);
  }

  // Auto-sync (disabled by default - use `lore watch` instead)
  if (AUTO_SYNC) {
    // Initial sync check
    await syncCheck();

    // Periodic sync check
    setInterval(syncCheck, SYNC_INTERVAL_MS);
    console.error(`[lore] Auto-sync enabled (every ${SYNC_INTERVAL_MS / 60000} minutes)`);
  } else {
    console.error(`[lore] Auto-sync disabled. Use 'lore watch' for visible sync, or set LORE_AUTO_SYNC=true`);
  }

  const server = new Server(
    {
      name: 'lore',
      version: '0.8.8',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  const extensionRegistry = await getExtensionRegistry({
    logger: (message) => console.error(message),
  });

  if (WATCH_EXTENSIONS) {
    const extensionsDir = getExtensionsDir();
    const watchPatterns = [
      path.join(extensionsDir, '**/package.json'),
      path.join(extensionsDir, '**/dist/**'),
    ];

    let reloadTimer: NodeJS.Timeout | null = null;
    const scheduleReload = (event: string, filePath: string) => {
      if (reloadTimer) {
        clearTimeout(reloadTimer);
      }

      reloadTimer = setTimeout(async () => {
        reloadTimer = null;
        try {
          const relativePath = path.relative(extensionsDir, filePath);
          console.error(`[extensions] Change detected (${event}: ${relativePath})`);
          await extensionRegistry.reload();
        } catch (error) {
          console.error('[extensions] Reload failed:', error);
        }
      }, 500);
    };

    const watcher = chokidar.watch(watchPatterns, {
      ignoreInitial: true,
    });

    watcher.on('all', (event, filePath) => {
      if (!filePath) {
        return;
      }
      scheduleReload(event, filePath);
    });

    console.error('[extensions] Watching for changes in installed extensions');
  }

  // List available tools (core tools only - extensions are event-driven middleware)
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: toolDefinitions };
  });

  // Handle tool calls (core tools only)
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const { name, arguments: args } = request.params;

    // Build a progress callback for long-running tools.
    // If the client sent a progressToken, we send notifications/progress back;
    // otherwise, onProgress is a no-op.
    const progressToken = request.params._meta?.progressToken;
    const onProgress = progressToken
      ? async (progress: number, total?: number, message?: string) => {
          try {
            await extra.sendNotification({
              method: 'notifications/progress',
              params: { progressToken, progress, ...(total != null ? { total } : {}), ...(message ? { message } : {}) },
            });
          } catch {
            // Progress notifications are best-effort
          }
        }
      : undefined;

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

          case 'list_sources': {
            const listArgs = args as any;
            result = await handleListSources(DB_PATH, {
              ...listArgs,
              limit: listArgs.limit ?? 20,
            });
            break;
          }

          case 'list_projects':
            result = await handleListProjects(DB_PATH);
            break;

          // Direct document ingestion
          case 'ingest':
            result = await handleIngest(DB_PATH, LORE_DATA_DIR, args as any, {
              autoPush: AUTO_GIT_PUSH,
              hookContext: { mode: 'mcp' },
            });
            break;

          // Agentic research tool — runs async, returns job_id immediately
          case 'research':
            result = startResearchJob(DB_PATH, LORE_DATA_DIR, args as any, {
              hookContext: { mode: 'mcp' },
              onProgress,
            });
            break;

          // Poll for research results (long-polls up to 20s)
          case 'research_status':
            result = await getResearchJobStatus((args as any)?.job_id);
            break;

          // Sync tool
          case 'sync':
            result = await handleSync(DB_PATH, LORE_DATA_DIR, args as any, {
              hookContext: { mode: 'mcp' },
              onProgress,
            });
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
