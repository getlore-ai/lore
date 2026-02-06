import { parentPort, workerData } from 'worker_threads';
import { pathToFileURL } from 'url';

import type { LoreExtension } from './types.js';

interface WorkerInitData {
  modulePath: string;
  cacheBust?: string;
  extensionName?: string;
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
  } catch (error) {
    extensionLoadError = getErrorMessage(error);
    console.error(`[extensions] Worker failed to load extension: ${extensionLoadError}`);
  }
})();

if (!parentPort) {
  throw new Error('Worker must be started with a parent port');
}

// Worker is now primarily used for sandboxed hook/middleware execution
// Tool handling has been removed - extensions are event-driven middleware only
const port = parentPort;
port.on('message', async () => {
  await extensionReady;
  // No-op for now - hooks and middleware are executed in the main thread
});
