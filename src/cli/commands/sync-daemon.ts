/**
 * Sync - Daemon
 *
 * Background sync daemon: start, stop, restart, status helpers.
 */

import { spawnSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { mkdir } from 'fs/promises';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

import { isMacOS, isLaunchdInstalled, uninstallLaunchdAgent, installLaunchdAgent } from './sync-launchd.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Config directory for daemon files
export const CONFIG_DIR = path.join(os.homedir(), '.config', 'lore');
export const PID_FILE = path.join(CONFIG_DIR, 'daemon.pid');
export const STATUS_FILE = path.join(CONFIG_DIR, 'daemon.status.json');
export const LOG_FILE = path.join(CONFIG_DIR, 'daemon.log');

export interface DaemonStatus {
  pid: number;
  started_at: string;
  last_sync?: string;
  last_sync_result?: {
    files_scanned: number;
    files_processed: number;
    errors: number;
  };
}

export async function ensureConfigDir(): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true });
}

export function getPid(): number | null {
  if (!existsSync(PID_FILE)) return null;
  try {
    const pid = parseInt(readFileSync(PID_FILE, 'utf-8').trim(), 10);
    try {
      process.kill(pid, 0);
      return pid;
    } catch {
      unlinkSync(PID_FILE);
      return null;
    }
  } catch {
    return null;
  }
}

export function getStatus(): DaemonStatus | null {
  if (!existsSync(STATUS_FILE)) return null;
  try {
    return JSON.parse(readFileSync(STATUS_FILE, 'utf-8'));
  } catch {
    return null;
  }
}

export function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

export function formatAgo(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/**
 * Start the background sync daemon process.
 * Returns { pid } on success, null on failure.
 * If already running, returns the existing PID.
 */
export async function startDaemonProcess(dataDir: string): Promise<{ pid: number; alreadyRunning: boolean } | null> {
  await ensureConfigDir();

  const existingPid = getPid();
  if (existingPid) {
    return { pid: existingPid, alreadyRunning: true };
  }

  // Warn if data repo uses SSH remote — daemon may not have SSH agent access
  try {
    const { getGitRemoteUrl } = await import('../../core/data-repo.js');
    const { analyzeGitRemote } = await import('../../core/preflight.js');
    const remoteUrl = getGitRemoteUrl(dataDir);
    if (remoteUrl) {
      const analysis = analyzeGitRemote(remoteUrl);
      if (analysis.isSSH) {
        const { c } = await import('../colors.js');
        console.log(c.warning(`Warning: Git remote uses SSH (${remoteUrl}).`));
        console.log(c.dim('The background daemon may not have SSH agent access.'));
        if (analysis.httpsEquivalent) {
          console.log(c.dim(`Consider switching to HTTPS: git remote set-url origin ${analysis.httpsEquivalent}`));
        }
        console.log('');
      }
    }
  } catch {
    // Non-fatal — don't block daemon start
  }

  // macOS: use launchd for persistence across reboots
  if (isMacOS()) {
    const result = installLaunchdAgent(dataDir);
    if (result) {
      return { pid: result.pid, alreadyRunning: false };
    }
    return null;
  }

  // Non-macOS: use nohup fallback
  const scriptPath = path.join(__dirname, '..', '..', 'daemon-runner.js');
  const nodePath = process.execPath;

  const tmpScript = path.join(os.tmpdir(), `lore-daemon-start-${Date.now()}.sh`);
  const scriptContent = `#!/bin/bash\nnohup "${nodePath}" "${scriptPath}" "${dataDir}" > /dev/null 2>&1 &\n`;
  writeFileSync(tmpScript, scriptContent, { mode: 0o755 });

  spawnSync('/bin/bash', [tmpScript], { stdio: 'ignore' });

  try { unlinkSync(tmpScript); } catch {}

  // Wait for daemon to start and write PID file
  await new Promise(resolve => setTimeout(resolve, 1000));

  try {
    const daemonPid = parseInt(readFileSync(PID_FILE, 'utf-8').trim(), 10);
    process.kill(daemonPid, 0); // Verify running
    return { pid: daemonPid, alreadyRunning: false };
  } catch {
    return null;
  }
}

/**
 * Restart the background sync daemon.
 * Stops the existing daemon (if running), then starts a fresh one.
 * Returns { pid } on success, null on failure.
 */
export async function restartDaemon(dataDir: string): Promise<{ pid: number } | null> {
  // Uninstall launchd agent so it doesn't auto-restart during our restart
  if (isLaunchdInstalled()) {
    uninstallLaunchdAgent();
  }

  const pid = getPid();
  if (pid) {
    try {
      process.kill(pid, 'SIGTERM');
      if (existsSync(PID_FILE)) unlinkSync(PID_FILE);
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch {
      // Process might already be dead
    }
  }

  // startDaemonProcess will reinstall launchd with fresh config on macOS
  const result = await startDaemonProcess(dataDir);
  if (!result) return null;
  return { pid: result.pid };
}

/**
 * Check if the sync daemon is currently running.
 */
export function isDaemonRunning(): boolean {
  return getPid() !== null;
}

// Re-export launchd helpers used by sync.ts command handlers
export { isLaunchdInstalled } from './sync-launchd.js';
