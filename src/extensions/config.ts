/**
 * Lore - Extension Configuration
 *
 * Stores installed extensions in ~/.config/lore/extensions.json
 * Packages are installed under ~/.config/lore/extensions
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import os from 'os';

// ============================================================================
// Types
// ============================================================================

export interface ExtensionConfigEntry {
  name: string;
  version?: string;
  enabled?: boolean;
}

export interface ExtensionConfig {
  version: number;
  extensions: ExtensionConfigEntry[];
}

// ============================================================================
// Paths
// ============================================================================

const CONFIG_DIR = path.join(os.homedir(), '.config', 'lore');
const EXTENSIONS_DIR = path.join(CONFIG_DIR, 'extensions');
const CONFIG_FILE = path.join(CONFIG_DIR, 'extensions.json');

export function getExtensionsDir(): string {
  return EXTENSIONS_DIR;
}

export function getExtensionsConfigPath(): string {
  return CONFIG_FILE;
}

// ============================================================================
// Defaults
// ============================================================================

function getDefaultConfig(): ExtensionConfig {
  return {
    version: 1,
    extensions: [],
  };
}

// ============================================================================
// Config IO
// ============================================================================

export async function loadExtensionConfig(): Promise<ExtensionConfig> {
  if (!existsSync(CONFIG_FILE)) {
    return getDefaultConfig();
  }

  try {
    const content = await readFile(CONFIG_FILE, 'utf-8');
    const config = JSON.parse(content) as ExtensionConfig;

    if (config.version !== 1) {
      console.warn(`[extensions] Unknown config version: ${config.version}, expected 1`);
    }

    if (!Array.isArray(config.extensions)) {
      throw new Error('Invalid extensions config: extensions must be an array');
    }

    return config;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return getDefaultConfig();
    }
    throw error;
  }
}

export async function saveExtensionConfig(config: ExtensionConfig): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true });
  await writeFile(CONFIG_FILE, JSON.stringify(config, null, 2));
}

export async function ensureExtensionsDir(): Promise<void> {
  await mkdir(EXTENSIONS_DIR, { recursive: true });

  const packageJsonPath = path.join(EXTENSIONS_DIR, 'package.json');
  if (!existsSync(packageJsonPath)) {
    const packageJson = {
      name: 'lore-extensions',
      private: true,
      version: '0.0.0',
      description: 'Installed Lore extensions',
    };
    await writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2));
  }
}

// ============================================================================
// Config Manipulation
// ============================================================================

export async function addExtensionToConfig(
  name: string,
  version?: string,
  enabled: boolean = true
): Promise<ExtensionConfig> {
  const config = await loadExtensionConfig();
  const existingIndex = config.extensions.findIndex((ext) => ext.name === name);

  if (existingIndex !== -1) {
    config.extensions[existingIndex] = {
      ...config.extensions[existingIndex],
      version: version ?? config.extensions[existingIndex].version,
      enabled,
    };
  } else {
    config.extensions.push({ name, version, enabled });
  }

  await saveExtensionConfig(config);
  return config;
}

export async function removeExtensionFromConfig(name: string): Promise<ExtensionConfig> {
  const config = await loadExtensionConfig();
  const index = config.extensions.findIndex((ext) => ext.name === name);

  if (index === -1) {
    return config;
  }

  config.extensions.splice(index, 1);
  await saveExtensionConfig(config);
  return config;
}
