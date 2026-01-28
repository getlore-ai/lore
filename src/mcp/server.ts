#!/usr/bin/env node

/**
 * Lore - MCP Server
 *
 * Exposes knowledge repository tools via Model Context Protocol.
 * Supports both simple query tools and agentic research capabilities.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import path from 'path';

import { toolDefinitions } from './tools.js';
import { handleSearch } from './handlers/search.js';
import { handleGetSource } from './handlers/get-source.js';
import { handleListSources } from './handlers/list-sources.js';
import { handleGetQuotes } from './handlers/get-quotes.js';
import { handleRetain } from './handlers/retain.js';
import { handleResearch } from './handlers/research.js';
import { handleListProjects } from './handlers/list-projects.js';
import { indexExists } from '../core/vector-store.js';

// Configuration from environment
const LORE_DATA_DIR = process.env.LORE_DATA_DIR || './data';
const DB_PATH = path.join(LORE_DATA_DIR, 'lore.lance');

async function main() {
  // Check if index exists
  const hasIndex = await indexExists(DB_PATH);
  if (!hasIndex) {
    console.error(`Note: No index found at ${DB_PATH}. Run 'lore ingest' to add sources.`);
  }

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
          result = await handleSearch(DB_PATH, args as any);
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
          result = await handleRetain(DB_PATH, LORE_DATA_DIR, args as any);
          break;

        // Agentic research tool (uses Claude Agent SDK internally)
        case 'research':
          result = await handleResearch(DB_PATH, LORE_DATA_DIR, args as any);
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
