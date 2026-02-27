/**
 * Sync - launchd (macOS)
 *
 * macOS launchd agent install/uninstall for persistent daemon.
 */

import { spawnSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Local copies of path constants to avoid circular dependency with sync-daemon
const CONFIG_DIR = path.join(os.homedir(), '.config', 'lore');
const PID_FILE = path.join(CONFIG_DIR, 'daemon.pid');
const LOG_FILE = path.join(CONFIG_DIR, 'daemon.log');

const LAUNCHD_LABEL = 'com.lore.daemon';
const LAUNCHD_PLIST_PATH = path.join(os.homedir(), 'Library', 'LaunchAgents', `${LAUNCHD_LABEL}.plist`);

export function isMacOS(): boolean {
  return process.platform === 'darwin';
}

export function generatePlist(dataDir: string): string {
  const nodePath = process.execPath;
  const scriptPath = path.join(__dirname, '..', '..', 'daemon-runner.js');

  // Pass SSH_AUTH_SOCK so the daemon can git pull/push over SSH.
  // The socket path may change on reboot, but this helps for same-session starts.
  const sshAuthSock = process.env.SSH_AUTH_SOCK;
  const xmlEscape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const envVarsBlock = sshAuthSock
    ? `
  <key>EnvironmentVariables</key>
  <dict>
    <key>SSH_AUTH_SOCK</key>
    <string>${xmlEscape(sshAuthSock)}</string>
  </dict>`
    : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LAUNCHD_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodePath}</string>
    <string>${scriptPath}</string>
    <string>${dataDir}</string>
  </array>${envVarsBlock}
  <key>KeepAlive</key>
  <true/>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${LOG_FILE}</string>
  <key>StandardErrorPath</key>
  <string>${LOG_FILE}</string>
</dict>
</plist>`;
}

export function isLaunchdInstalled(): boolean {
  return isMacOS() && existsSync(LAUNCHD_PLIST_PATH);
}

export function installLaunchdAgent(dataDir: string): { pid: number } | null {
  const plistDir = path.dirname(LAUNCHD_PLIST_PATH);
  if (!existsSync(plistDir)) {
    // LaunchAgents dir should exist, but just in case
    spawnSync('mkdir', ['-p', plistDir]);
  }

  writeFileSync(LAUNCHD_PLIST_PATH, generatePlist(dataDir));

  // Unload first in case an old version is loaded
  spawnSync('launchctl', ['unload', LAUNCHD_PLIST_PATH], { stdio: 'ignore' });

  const result = spawnSync('launchctl', ['load', LAUNCHD_PLIST_PATH], { stdio: 'pipe' });
  if (result.status !== 0) {
    const stderr = result.stderr?.toString().trim();
    if (stderr) console.error(`launchctl load error: ${stderr}`);
    return null;
  }

  // launchctl load starts the process (RunAtLoad=true). Wait for PID file.
  // The daemon-runner writes PID_FILE on startup.
  for (let i = 0; i < 20; i++) {
    spawnSync('sleep', ['0.25']);
    if (existsSync(PID_FILE)) {
      try {
        const pid = parseInt(readFileSync(PID_FILE, 'utf-8').trim(), 10);
        process.kill(pid, 0); // verify alive
        return { pid };
      } catch {
        // PID file exists but process not ready yet, keep waiting
      }
    }
  }

  return null;
}

export function uninstallLaunchdAgent(): void {
  if (!existsSync(LAUNCHD_PLIST_PATH)) return;

  spawnSync('launchctl', ['unload', LAUNCHD_PLIST_PATH], { stdio: 'ignore' });
  try { unlinkSync(LAUNCHD_PLIST_PATH); } catch {}
}
