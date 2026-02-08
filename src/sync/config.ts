/**
 * Lore - Sync Configuration
 *
 * Loads and validates sync-sources.json from ~/.config/lore/sync-sources.json
 * This config is machine-specific (NOT in lore-data).
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import os from 'os';

// ============================================================================
// Types
// ============================================================================

export interface SyncSource {
  name: string;           // Human-readable name
  path: string;           // Directory path (can use ~)
  glob: string;           // Glob pattern (e.g., "**/*")
  project: string;        // Default project for sources from this directory
  enabled: boolean;       // Whether to include in sync
}

export interface SyncConfig {
  version: number;
  sources: SyncSource[];
}

// ============================================================================
// Config Paths
// ============================================================================

const CONFIG_DIR = path.join(os.homedir(), '.config', 'lore');
const CONFIG_FILE = path.join(CONFIG_DIR, 'sync-sources.json');

export function getConfigPath(): string {
  return CONFIG_FILE;
}

// ============================================================================
// Path Expansion
// ============================================================================

export function expandPath(p: string): string {
  if (p.startsWith('~')) {
    return path.join(os.homedir(), p.slice(1));
  }
  return p;
}

// ============================================================================
// Default Config
// ============================================================================

function getDefaultConfig(): SyncConfig {
  return {
    version: 1,
    sources: [
      {
        name: 'Example Source',
        path: '~/Documents/notes',
        glob: '**/*',
        project: 'notes',
        enabled: false,
      },
    ],
  };
}

// ============================================================================
// Config Loading
// ============================================================================

export async function loadSyncConfig(): Promise<SyncConfig> {
  if (!existsSync(CONFIG_FILE)) {
    return getDefaultConfig();
  }

  try {
    const content = await readFile(CONFIG_FILE, 'utf-8');
    const config = JSON.parse(content) as SyncConfig;

    // Validate version
    if (config.version !== 1) {
      console.warn(`[sync-config] Unknown config version: ${config.version}, expected 1`);
    }

    // Validate sources
    if (!Array.isArray(config.sources)) {
      throw new Error('Invalid config: sources must be an array');
    }

    for (const source of config.sources) {
      if (!source.name || typeof source.name !== 'string') {
        throw new Error(`Invalid source: missing or invalid 'name'`);
      }
      if (!source.path || typeof source.path !== 'string') {
        throw new Error(`Invalid source "${source.name}": missing or invalid 'path'`);
      }
      if (!source.glob || typeof source.glob !== 'string') {
        throw new Error(`Invalid source "${source.name}": missing or invalid 'glob'`);
      }
      if (!source.project || typeof source.project !== 'string') {
        throw new Error(`Invalid source "${source.name}": missing or invalid 'project'`);
      }
      if (typeof source.enabled !== 'boolean') {
        source.enabled = true; // Default to enabled
      }
    }

    return config;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return getDefaultConfig();
    }
    throw error;
  }
}

export async function saveSyncConfig(config: SyncConfig): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true });
  await writeFile(CONFIG_FILE, JSON.stringify(config, null, 2));
}

export async function initializeSyncConfig(): Promise<SyncConfig> {
  if (existsSync(CONFIG_FILE)) {
    return loadSyncConfig();
  }

  const config = getDefaultConfig();
  await saveSyncConfig(config);
  return config;
}

// ============================================================================
// Config Manipulation
// ============================================================================

export async function addSyncSource(source: SyncSource): Promise<SyncConfig> {
  const config = await loadSyncConfig();

  // Check for duplicate names
  const existingIndex = config.sources.findIndex(s => s.name === source.name);
  if (existingIndex !== -1) {
    throw new Error(`Source with name "${source.name}" already exists`);
  }

  config.sources.push(source);
  await saveSyncConfig(config);
  return config;
}

export async function updateSyncSource(
  name: string,
  updates: Partial<SyncSource>
): Promise<SyncConfig> {
  const config = await loadSyncConfig();

  const sourceIndex = config.sources.findIndex(s => s.name === name);
  if (sourceIndex === -1) {
    throw new Error(`Source "${name}" not found`);
  }

  config.sources[sourceIndex] = {
    ...config.sources[sourceIndex],
    ...updates,
  };

  await saveSyncConfig(config);
  return config;
}

export async function removeSyncSource(name: string): Promise<SyncConfig> {
  const config = await loadSyncConfig();

  const sourceIndex = config.sources.findIndex(s => s.name === name);
  if (sourceIndex === -1) {
    throw new Error(`Source "${name}" not found`);
  }

  config.sources.splice(sourceIndex, 1);
  await saveSyncConfig(config);
  return config;
}

export function getEnabledSources(config: SyncConfig): SyncSource[] {
  return config.sources.filter(s => s.enabled);
}
