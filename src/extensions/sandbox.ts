/**
 * Extension Sandbox
 *
 * Placeholder for potential future sandboxed execution of extension hooks/middleware.
 * Tool handling has been removed - extensions are now event-driven middleware only.
 */

export interface ExtensionSandboxOptions {
  logger: (message: string) => void;
  timeoutMs?: number;
}

export class ExtensionSandbox {
  private readonly logger: (message: string) => void;
  private readonly timeoutMs: number;

  constructor(options: ExtensionSandboxOptions) {
    this.logger = options.logger;
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  dispose(): void {
    // No-op for now
  }
}
