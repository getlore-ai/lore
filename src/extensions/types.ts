/**
 * Lore Extension Types
 */

import type { Command } from 'commander';
import type { ResearchPackage } from '../core/types.js';

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ExtensionToolContext {
  mode: 'mcp' | 'cli';
  dataDir?: string;
  dbPath?: string;
  logger?: (message: string) => void;
}

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

export interface ExtensionHooks {
  onSourceCreated?: (event: SourceCreatedEvent, context: ExtensionToolContext) => void | Promise<void>;
  onResearchCompleted?: (result: ResearchPackage, context: ExtensionToolContext) => void | Promise<void>;
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

  tools?: ExtensionTool[];
  commands?: ExtensionCommand[];
  hooks?: ExtensionHooks;
  components?: ComponentDefinition[];
}
