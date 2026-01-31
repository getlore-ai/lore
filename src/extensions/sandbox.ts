import { Worker } from 'worker_threads';
import { randomUUID } from 'crypto';

import type { ExtensionToolContext } from './types.js';

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

export interface ExtensionRoute {
  extensionName: string;
  packageName: string;
  modulePath: string;
  cacheBust?: string;
  permissions?: import('./types.js').ExtensionPermissions;
}

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

interface WorkerState {
  route: ExtensionRoute;
  worker: Worker | null;
  pending: Map<string, PendingCall>;
  unavailableReason?: string;
  terminating: boolean;
}

interface ExtensionSandboxOptions {
  logger: (message: string) => void;
  timeoutMs?: number;
}

export class ExtensionSandbox {
  private readonly logger: (message: string) => void;
  private readonly timeoutMs: number;
  private readonly workers: Map<string, WorkerState>;

  constructor(options: ExtensionSandboxOptions) {
    this.logger = options.logger;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.workers = new Map();
  }

  async callTool(
    route: ExtensionRoute,
    toolName: string,
    args: Record<string, unknown>,
    context: ExtensionToolContext
  ): Promise<unknown> {
    const state = this.getState(route);

    if (state.unavailableReason) {
      throw new Error(state.unavailableReason);
    }

    const worker = await this.ensureWorker(state);
    const id = randomUUID();

    const sanitizedContext: ExtensionToolContext = {
      mode: context.mode,
      dataDir: context.dataDir,
      dbPath: context.dbPath,
    };

    return new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.logger(
          `[extensions] Tool ${toolName} timed out in ${route.extensionName} after ${this.timeoutMs}ms`
        );
        this.failWorker(state, new Error(`Tool ${toolName} timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);

      state.pending.set(id, { resolve, reject, timeout });

      const message: ToolCallRequest = {
        type: 'call',
        id,
        toolName,
        args,
        context: sanitizedContext,
      };

      worker.postMessage(message);
    });
  }

  dispose(): void {
    for (const state of this.workers.values()) {
      this.terminateWorker(state, 'Sandbox disposed');
    }
    this.workers.clear();
  }

  private getState(route: ExtensionRoute): WorkerState {
    const key = route.modulePath;
    const existing = this.workers.get(key);
    if (existing) {
      return existing;
    }

    const state: WorkerState = {
      route,
      worker: null,
      pending: new Map(),
      terminating: false,
    };

    this.workers.set(key, state);
    return state;
  }

  private async ensureWorker(state: WorkerState): Promise<Worker> {
    if (state.worker && !state.terminating) {
      return state.worker;
    }

    if (state.unavailableReason) {
      throw new Error(state.unavailableReason);
    }

    const worker = new Worker(new URL('./worker.js', import.meta.url), {
      workerData: {
        modulePath: state.route.modulePath,
        cacheBust: state.route.cacheBust,
        extensionName: state.route.extensionName,
      },
    } as ConstructorParameters<typeof Worker>[1]);

    state.worker = worker;
    state.terminating = false;

    worker.on('message', (message: ToolCallResult | ToolCallError) => {
      this.handleMessage(state, message);
    });

    worker.on('error', (error) => {
      this.logger(
        `[extensions] Worker error in ${state.route.extensionName}: ${error instanceof Error ? error.message : String(error)}`
      );
      this.failWorker(state, new Error(`Worker error in ${state.route.extensionName}`));
    });

    worker.on('exit', (code) => {
      if (state.terminating) {
        return;
      }
      this.logger(`[extensions] Worker exited for ${state.route.extensionName} (code ${code})`);
      this.failWorker(state, new Error(`Worker exited for ${state.route.extensionName}`));
    });

    return worker;
  }

  private handleMessage(state: WorkerState, message: ToolCallResult | ToolCallError): void {
    if (!message || !('id' in message)) {
      return;
    }

    const pending = state.pending.get(message.id);
    if (!pending) {
      return;
    }

    clearTimeout(pending.timeout);
    state.pending.delete(message.id);

    if (message.type === 'result') {
      pending.resolve(message.result);
      return;
    }

    if (message.type === 'error') {
      if (message.error.startsWith('EXTENSION_LOAD_FAILED:')) {
        state.unavailableReason = `[extensions] ${state.route.extensionName} failed to load: ${message.error.replace(
          'EXTENSION_LOAD_FAILED: ',
          ''
        )}`;
        this.logger(state.unavailableReason);
        this.failWorker(state, new Error(state.unavailableReason));
        return;
      }
      pending.reject(new Error(message.error));
    }
  }

  private failWorker(state: WorkerState, error: Error): void {
    for (const pending of state.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    state.pending.clear();
    this.terminateWorker(state, error.message);
  }

  private terminateWorker(state: WorkerState, reason: string): void {
    if (!state.worker || state.terminating) {
      return;
    }

    state.terminating = true;
    const worker = state.worker;
    state.worker = null;

    worker.terminate().catch((error) => {
      this.logger(
        `[extensions] Failed to terminate worker for ${state.route.extensionName}: ${error instanceof Error ? error.message : String(error)}`
      );
    });

    if (reason) {
      this.logger(`[extensions] Worker terminated for ${state.route.extensionName}: ${reason}`);
    }
  }
}
