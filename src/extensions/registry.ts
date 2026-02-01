/**
 * Lore Extension Registry + Loader
 */

import { createRequire } from 'module';
import path from 'path';
import { readFile } from 'fs/promises';
import { fileURLToPath, pathToFileURL } from 'url';

import {
  getExtensionsDir,
  loadExtensionConfig,
  type ExtensionConfigEntry,
} from './config.js';
import { getAllSources } from '../core/vector-store.js';
import { createProposal } from './proposals.js';
import type {
  LoreExtension,
  ExtensionToolContext,
  ExtensionQueryOptions,
  ExtensionQueryResult,
  ExtensionCommandContext,
  ExtensionMiddleware,
  ExtensionPermissions,
  LoreEventType,
  EventHandler,
  LoreEvent,
} from './types.js';
import type { Command } from 'commander';

interface LoadedExtension {
  extension: LoreExtension;
  packageName: string;
  modulePath: string;
}

interface ExtensionRegistryOptions {
  extensionsDir?: string;
  logger?: (message: string) => void;
  loreVersion?: string;
  cacheBust?: string;
}

function getLogger(logger?: (message: string) => void): (message: string) => void {
  return logger || ((message: string) => console.error(message));
}

function createQueryFunction(): (options: ExtensionQueryOptions) => Promise<ExtensionQueryResult[]> {
  return async (options: ExtensionQueryOptions): Promise<ExtensionQueryResult[]> => {
    try {
      // Get all sources for project (search with embeddings requires more complex setup)
      const results = await getAllSources('', {
        project: options.project,
        limit: options.limit || 100,
        source_type: options.sourceType as any,
      });
      return results.map((r) => ({
        id: r.id,
        title: r.title,
        summary: r.summary || '',
        projects: r.projects || [],
        created_at: r.created_at,
      }));
    } catch (error) {
      console.error('[extensions] Query failed:', error);
      return [];
    }
  };
}

function createAskFunction(
  dbPath: string
): (question: string, options?: { project?: string; maxSources?: number }) => Promise<string> {
  return async (question, options = {}) => {
    try {
      // Lazy import to avoid circular dependencies
      const { default: Anthropic } = await import('@anthropic-ai/sdk');
      const { searchSources } = await import('../core/vector-store.js');
      const { generateEmbedding } = await import('../core/embedder.js');

      if (!process.env.ANTHROPIC_API_KEY) {
        throw new Error('ANTHROPIC_API_KEY not set');
      }

      // Search for relevant sources
      const embedding = await generateEmbedding(question);
      const sources = await searchSources(dbPath, embedding, {
        limit: options.maxSources || 10,
        project: options.project,
        queryText: question,
        mode: 'hybrid',
      });

      if (sources.length === 0) {
        return 'No relevant sources found.';
      }

      // Build context
      const sourceContext = sources.map((s, i) => {
        return `[Source ${i + 1}: ${s.title}]\n${s.summary}`;
      }).join('\n\n---\n\n');

      // Call AI
      const anthropic = new Anthropic();
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2048,
        system: 'You are a research assistant. Answer based on the provided sources. Be concise.',
        messages: [{
          role: 'user',
          content: `Question: ${question}\n\n---\nSources:\n${sourceContext}`
        }],
      });

      const textBlocks = response.content.filter(block => block.type === 'text');
      return textBlocks.map(block => (block as { text: string }).text).join('\n');
    } catch (error) {
      console.error('[extensions] Ask failed:', error);
      throw error;
    }
  };
}

export function createProposeFunction(
  extensionName: string,
  permissions?: ExtensionPermissions
): (change: import('./proposals.js').ProposedChange) => Promise<import('./proposals.js').PendingProposal> {
  return async (change) => {
    // Enforce permissions
    const perms = permissions || {};
    
    if (change.type === 'create_source' || change.type === 'retain_insight') {
      if (!perms.proposeCreate) {
        throw new Error(`Extension "${extensionName}" does not have permission to propose creating documents. Add permissions.proposeCreate = true to the extension.`);
      }
    }
    
    if (change.type === 'update_source' || change.type === 'add_tags') {
      if (!perms.proposeModify) {
        throw new Error(`Extension "${extensionName}" does not have permission to propose modifications. Add permissions.proposeModify = true to the extension.`);
      }
    }
    
    if (change.type === 'delete_source') {
      if (!perms.proposeDelete) {
        throw new Error(`Extension "${extensionName}" does not have permission to propose deletions. Add permissions.proposeDelete = true to the extension.`);
      }
    }
    
    return createProposal(extensionName, change);
  };
}

async function resolveLoreExtension(mod: Record<string, unknown>): Promise<LoreExtension | null> {
  const candidate =
    (mod.loreExtension as LoreExtension | undefined) ||
    (mod.default as LoreExtension | (() => LoreExtension | Promise<LoreExtension>) | undefined);

  if (!candidate) {
    return null;
  }

  if (typeof candidate === 'function') {
    const result = await candidate();
    return result;
  }

  return candidate;
}

function validateExtension(extension: LoreExtension, logger: (message: string) => void): boolean {
  if (!extension.name || !extension.version) {
    logger(`[extensions] Skipping extension with missing name/version`);
    return false;
  }
  return true;
}

function checkCompatibility(
  extension: LoreExtension,
  loreVersion: string | undefined,
  logger: (message: string) => void
): void {
  const required = extension.compatibility?.loreVersion;
  if (!required || !loreVersion) {
    return;
  }

  if (required !== loreVersion) {
    logger(
      `[extensions] Compatibility warning: ${extension.name} requires Lore ${required}, current ${loreVersion}`
    );
  }
}

async function getLoreVersion(): Promise<string | undefined> {
  const explicit = process.env.LORE_VERSION || process.env.npm_package_version;
  if (explicit) {
    return explicit;
  }

  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const packageJsonPath = path.resolve(here, '../../package.json');
    const content = await readFile(packageJsonPath, 'utf-8');
    const parsed = JSON.parse(content) as { version?: string };
    return parsed.version;
  } catch {
    return undefined;
  }
}

export class ExtensionRegistry {
  private extensions: LoadedExtension[];
  private readonly logger: (message: string) => void;
  private readonly options: ExtensionRegistryOptions;

  constructor(
    extensions: LoadedExtension[],
    logger: (message: string) => void,
    options: ExtensionRegistryOptions
  ) {
    this.extensions = extensions;
    this.logger = logger;
    this.options = options;
  }

  listExtensions(): LoadedExtension[] {
    return [...this.extensions];
  }

  private collectMiddleware(): ExtensionMiddleware[] {
    const chain: ExtensionMiddleware[] = [];
    for (const loaded of this.extensions) {
      const middleware = loaded.extension.middleware || [];
      for (const entry of middleware) {
        if (!entry?.name) {
          this.logger(
            `[extensions] Skipping unnamed middleware in ${loaded.extension.name}`
          );
          continue;
        }
        chain.push(entry);
      }
    }
    return chain;
  }

  private collectEventHandlers(type: LoreEventType): EventHandler[] {
    const handlers: EventHandler[] = [];
    for (const loaded of this.extensions) {
      const handler = loaded.extension.events?.[type];
      if (handler) {
        handlers.push(handler);
      }
    }
    return handlers;
  }

  async emitEvent(
    type: LoreEventType,
    payload: unknown,
    context: ExtensionToolContext
  ): Promise<void> {
    const event: LoreEvent = {
      type,
      payload,
      timestamp: Date.now(),
    };
    const handlers = this.collectEventHandlers(type);
    for (const handler of handlers) {
      try {
        await handler(event, {
          ...context,
          logger: context.logger || this.logger,
        });
      } catch (error) {
        this.logger(
          `[extensions] Event ${type} handler failed: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }
  }

  registerCommands(program: Command, context: ExtensionCommandContext): void {
    for (const loaded of this.extensions) {
      const commands = loaded.extension.commands || [];
      for (const command of commands) {
        try {
          command.register(program, {
            ...context,
            logger: context.logger || this.logger,
          });
        } catch (error) {
          this.logger(
            `[extensions] Failed to register command ${command.name} from ${loaded.extension.name}: ${String(error)}`
          );
        }
      }
    }
  }

  async runHook(
    hookName: keyof NonNullable<LoreExtension['hooks']>,
    payload: unknown,
    context: ExtensionToolContext
  ): Promise<void> {
    for (const loaded of this.extensions) {
      const hook = loaded.extension.hooks?.[hookName];
      if (!hook) {
        continue;
      }

      try {
        await hook(payload as never, {
          ...context,
          logger: context.logger || this.logger,
        });
      } catch (error) {
        this.logger(
          `[extensions] Hook ${String(hookName)} failed in ${loaded.extension.name}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }
  }

  async reload(): Promise<void> {
    this.logger('[extensions] Reloading extensions');
    const cacheBust = `${Date.now()}`;
    const updated = await loadExtensionRegistry({
      ...this.options,
      logger: this.logger,
      cacheBust,
    });

    this.extensions = updated.extensions;
    this.logger('[extensions] Extensions reloaded');
  }
}

export async function loadExtensionRegistry(
  options: ExtensionRegistryOptions = {}
): Promise<ExtensionRegistry> {
  const logger = getLogger(options.logger);
  const loreVersion = options.loreVersion ?? (await getLoreVersion());
  const extensionsDir = options.extensionsDir || getExtensionsDir();
  const resolvedOptions: ExtensionRegistryOptions = {
    ...options,
    logger,
    loreVersion,
    extensionsDir,
  };

  const config = await loadExtensionConfig();
  const enabledExtensions = config.extensions.filter((ext) => ext.enabled !== false);

  const loadedExtensions: LoadedExtension[] = [];

  const require = createRequire(import.meta.url);

  for (const entry of enabledExtensions) {
    const loaded = await loadSingleExtension(
      entry,
      extensionsDir,
      require,
      loreVersion,
      logger,
      options.cacheBust
    );
    if (!loaded) {
      continue;
    }

    loadedExtensions.push(loaded);
  }

  return new ExtensionRegistry(
    loadedExtensions,
    logger,
    resolvedOptions
  );
}

async function loadSingleExtension(
  entry: ExtensionConfigEntry,
  extensionsDir: string,
  require: NodeRequire,
  loreVersion: string | undefined,
  logger: (message: string) => void,
  cacheBust?: string
): Promise<LoadedExtension | null> {
  try {
    const resolved = require.resolve(entry.name, { paths: [extensionsDir] });
    const moduleUrl = pathToFileURL(resolved).href;
    const importUrl = cacheBust ? `${moduleUrl}?t=${cacheBust}` : moduleUrl;
    const mod = await import(importUrl);
    const extension = await resolveLoreExtension(mod as Record<string, unknown>);

    if (!extension) {
      logger(`[extensions] ${entry.name} does not export a Lore extension`);
      return null;
    }

    if (!validateExtension(extension, logger)) {
      return null;
    }

    checkCompatibility(extension, loreVersion, logger);

    return {
      extension,
      packageName: entry.name,
      modulePath: resolved,
    };
  } catch (error) {
    logger(
      `[extensions] Failed to load ${entry.name}: ${error instanceof Error ? error.message : String(error)}`
    );
    return null;
  }
}

let registryPromise: Promise<ExtensionRegistry> | null = null;

export async function getExtensionRegistry(
  options: ExtensionRegistryOptions = {}
): Promise<ExtensionRegistry> {
  if (!registryPromise) {
    registryPromise = loadExtensionRegistry(options);
  }
  return registryPromise;
}

export function clearExtensionRegistry(): void {
  registryPromise = null;
}

export async function getLoreVersionString(): Promise<string | undefined> {
  return getLoreVersion();
}
