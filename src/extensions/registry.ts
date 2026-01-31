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
import type {
  LoreExtension,
  ToolDefinition,
  ExtensionTool,
  ExtensionToolContext,
  ExtensionCommandContext,
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
  private toolDefinitions: ToolDefinition[];
  private toolHandlers: Map<string, ExtensionTool>;
  private readonly logger: (message: string) => void;
  private readonly options: ExtensionRegistryOptions;

  constructor(
    extensions: LoadedExtension[],
    toolDefinitions: ToolDefinition[],
    toolHandlers: Map<string, ExtensionTool>,
    logger: (message: string) => void,
    options: ExtensionRegistryOptions
  ) {
    this.extensions = extensions;
    this.toolDefinitions = toolDefinitions;
    this.toolHandlers = toolHandlers;
    this.logger = logger;
    this.options = options;
  }

  listExtensions(): LoadedExtension[] {
    return [...this.extensions];
  }

  getToolDefinitions(): ToolDefinition[] {
    return [...this.toolDefinitions];
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

  async handleToolCall(
    name: string,
    args: Record<string, unknown>,
    context: ExtensionToolContext
  ): Promise<{ handled: boolean; result?: unknown }> {
    const tool = this.toolHandlers.get(name);
    if (!tool) {
      return { handled: false };
    }

    const extensionContext: ExtensionToolContext = {
      ...context,
      logger: context.logger || this.logger,
    };

    try {
      const result = await tool.handler(args, extensionContext);
      return { handled: true, result };
    } catch (error) {
      this.logger(
        `[extensions] Tool ${name} failed: ${error instanceof Error ? error.message : String(error)}`
      );
      throw error;
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
    this.toolDefinitions = updated.toolDefinitions;
    this.toolHandlers = updated.toolHandlers;
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

  const toolDefinitions: ToolDefinition[] = [];
  const toolHandlers = new Map<string, ExtensionTool>();
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

    const tools = loaded.extension.tools || [];
    for (const tool of tools) {
      if (!tool.definition?.name || !tool.handler) {
        logger(`[extensions] Invalid tool definition in ${loaded.extension.name}`);
        continue;
      }

      if (toolHandlers.has(tool.definition.name)) {
        logger(
          `[extensions] Duplicate tool name "${tool.definition.name}" from ${loaded.extension.name}, skipping`
        );
        continue;
      }

      toolHandlers.set(tool.definition.name, tool);
      toolDefinitions.push(tool.definition);
    }
  }

  return new ExtensionRegistry(loadedExtensions, toolDefinitions, toolHandlers, logger, resolvedOptions);
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
