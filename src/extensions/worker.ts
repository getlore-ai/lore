import { parentPort, workerData } from 'worker_threads';
import { pathToFileURL } from 'url';

import type { LoreExtension, ExtensionToolContext, ExtensionToolHandler } from './types.js';

interface WorkerInitData {
  modulePath: string;
  cacheBust?: string;
  extensionName?: string;
}

interface ToolCallRequest {
  type: 'call';
  id: string;
  toolName: string;
  args: Record<string, unknown>;
  context: ExtensionToolContext;
}

interface ToolCallResult {
  type: 'result';
  id: string;
  result: unknown;
}

interface ToolCallError {
  type: 'error';
  id: string;
  error: string;
}

const initData = workerData as WorkerInitData;

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
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

let extension: LoreExtension | null = null;
let extensionLoadError: string | null = null;
let toolHandlers: Map<string, ExtensionToolHandler> | null = null;

const extensionReady = (async () => {
  try {
    const moduleUrl = pathToFileURL(initData.modulePath).href;
    const importUrl = initData.cacheBust ? `${moduleUrl}?t=${initData.cacheBust}` : moduleUrl;
    const mod = await import(importUrl);
    const resolved = await resolveLoreExtension(mod as Record<string, unknown>);

    if (!resolved) {
      throw new Error(`${initData.modulePath} does not export a Lore extension`);
    }

    extension = resolved;
    toolHandlers = new Map();

    const tools = resolved.tools || [];
    for (const tool of tools) {
      if (tool.definition?.name && typeof tool.handler === 'function') {
        toolHandlers.set(tool.definition.name, tool.handler);
      }
    }
  } catch (error) {
    extensionLoadError = getErrorMessage(error);
    console.error(`[extensions] Worker failed to load extension: ${extensionLoadError}`);
  }
})();

function buildContext(context: ExtensionToolContext): ExtensionToolContext {
  return {
    ...context,
    logger:
      context.logger ||
      ((message: string) => {
        console.error(message);
      }),
  };
}

async function handleCall(request: ToolCallRequest): Promise<ToolCallResult | ToolCallError> {
  await extensionReady;

  if (extensionLoadError || !extension) {
    return {
      type: 'error',
      id: request.id,
      error: `EXTENSION_LOAD_FAILED: ${extensionLoadError || 'Unknown error'}`,
    };
  }

  const handler = toolHandlers?.get(request.toolName);
  if (!handler) {
    return {
      type: 'error',
      id: request.id,
      error: `Tool not found: ${request.toolName}`,
    };
  }

  try {
    const result = await handler(request.args, buildContext(request.context));
    return { type: 'result', id: request.id, result };
  } catch (error) {
    return { type: 'error', id: request.id, error: getErrorMessage(error) };
  }
}

if (!parentPort) {
  throw new Error('Worker must be started with a parent port');
}

const port = parentPort;
port.on('message', async (message: ToolCallRequest) => {
  if (!message || message.type !== 'call') {
    return;
  }

  const response = await handleCall(message);
  port.postMessage(response);
});
