/**
 * Lore Extension Types
 */

import type { Command } from 'commander';
import type { ResearchPackage } from '../core/types.js';
import type { ProposedChange, PendingProposal } from './proposals.js';

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

// Query function for extensions to search lore's database
export interface ExtensionQueryOptions {
  query?: string;
  project?: string;
  limit?: number;
  sourceType?: string;
}

export interface ExtensionQueryResult {
  id: string;
  title: string;
  summary: string;
  content?: string;
  projects: string[];
  participants?: string[];
  created_at: string;
  score?: number;
}

// Extension permission levels
export interface ExtensionPermissions {
  read?: boolean;           // Query sources (default: true)
  proposeCreate?: boolean;  // Propose new documents (default: false)
  proposeModify?: boolean;  // Propose edits to existing (default: false)
  proposeDelete?: boolean;  // Propose deletion (default: false)
}

export interface AskOptions {
  project?: string;
  maxSources?: number;
}

export interface ExtensionToolContext {
  mode: 'mcp' | 'cli';
  dataDir?: string;
  dbPath?: string;
  logger?: (message: string) => void;
  // Query lore's database (use this instead of direct DB access)
  query?: (options: ExtensionQueryOptions) => Promise<ExtensionQueryResult[]>;
  // AI-powered question answering
  ask?: (question: string, options?: AskOptions) => Promise<string>;
  // Propose a change that requires approval (respects extension permissions)
  propose?: (change: ProposedChange) => Promise<PendingProposal>;
}

export interface ExtensionMiddleware {
  name: string;
  // Called before any tool executes, can modify args or short-circuit
  beforeToolCall?: (
    toolName: string,
    args: Record<string, unknown>,
    context: ExtensionToolContext
  ) => Promise<{ args?: Record<string, unknown>; skip?: boolean; result?: unknown }>;
  // Called after tool executes, can modify result
  afterToolCall?: (
    toolName: string,
    args: Record<string, unknown>,
    result: unknown,
    context: ExtensionToolContext
  ) => Promise<unknown>;
}

export type LoreEventType =
  | 'search'
  | 'ingest'
  | 'sync'
  | 'tool.call'
  | 'tool.result'
  | 'startup'
  | 'shutdown';

export interface LoreEvent {
  type: LoreEventType;
  payload: unknown;
  timestamp: number;
}

export type EventHandler = (event: LoreEvent, context: ExtensionToolContext) => void | Promise<void>;

export type ExtensionToolHandler = (
  args: Record<string, unknown>,
  context: ExtensionToolContext
) => Promise<unknown> | unknown;

export interface ExtensionTool {
  definition: ToolDefinition;
  handler: ExtensionToolHandler;
}

export interface ExtensionCommandContext {
  defaultDataDir: string;
  logger?: (message: string) => void;
}

export interface ExtensionCommand {
  name: string;
  description?: string;
  register: (program: Command, context: ExtensionCommandContext) => void | Promise<void>;
}

export interface SourceCreatedEvent {
  id: string;
  title: string;
  source_type: string;
  content_type: string;
  created_at: string;
  imported_at: string;
  projects: string[];
  tags: string[];
  source_path?: string;
  content_hash?: string;
  sync_source?: string;
  original_file?: string;
}

export interface SyncCompletedEvent {
  newDocs: number;
  updatedDocs: number;
  totalDocs: number;
  project?: string;
}

export interface ExtensionHooks {
  /** Called when a new source is indexed */
  onSourceCreated?: (event: SourceCreatedEvent, context: ExtensionToolContext) => void | Promise<void>;
  
  /** Called when research completes */
  onResearchCompleted?: (result: ResearchPackage, context: ExtensionToolContext) => void | Promise<void>;
  
  /** Called when sync completes */
  onSyncCompleted?: (event: SyncCompletedEvent, context: ExtensionToolContext) => void | Promise<void>;
}

export interface ComponentDefinition {
  id: string;
  description?: string;
}

export interface ExtensionCompatibility {
  loreVersion?: string;
}

export interface LoreExtension {
  name: string;
  version: string;
  compatibility?: ExtensionCompatibility;
  
  // Permission level for this extension (default: read-only)
  permissions?: ExtensionPermissions;

  tools?: ExtensionTool[];
  commands?: ExtensionCommand[];
  hooks?: ExtensionHooks;
  components?: ComponentDefinition[];
  middleware?: ExtensionMiddleware[];
  events?: { [K in LoreEventType]?: EventHandler };
}
