/**
 * Extension-related rendering functions for the Lore Document Browser TUI
 *
 * Handles rendering of extension lists and details.
 */

import type { BrowserState, UIComponents } from './browse-types.js';
import { escapeForBlessed, truncate } from './browse-render.js';

/**
 * Render the extensions list
 */
export function renderExtensionsList(ui: UIComponents, state: BrowserState): void {
  const width = (ui.listContent.width as number) - 2;
  const height = (ui.listContent.height as number) - 1;
  const lines: string[] = [];

  if (state.extensionsList.length === 0) {
    lines.push('');
    lines.push('{blue-fg}  No extensions installed{/blue-fg}');
    lines.push('');
    lines.push('{blue-fg}  Install with:{/blue-fg}');
    lines.push('{cyan-fg}  lore extension install <package>{/cyan-fg}');
    ui.listContent.setContent(lines.join('\n'));
    return;
  }

  const visibleStart = Math.max(0, state.selectedExtensionIndex - Math.floor(height / 3));
  const visibleEnd = Math.min(state.extensionsList.length, visibleStart + height);

  for (let i = visibleStart; i < visibleEnd; i++) {
    const ext = state.extensionsList[i];
    const isSelected = i === state.selectedExtensionIndex;
    const accent = isSelected ? '{cyan-fg}>{/cyan-fg}' : ' ';
    const status = ext.enabled ? '{green-fg}[ok]{/green-fg}' : '{red-fg}[off]{/red-fg}';

    const name = truncate(ext.name, width - 10);
    const version = `v${ext.version}`;

    lines.push(`${accent} ${status} {bold}${escapeForBlessed(name)}{/bold}`);
    lines.push(`     {blue-fg}${escapeForBlessed(version)}{/blue-fg}`);
    lines.push('');
  }

  ui.listContent.setContent(lines.join('\n'));
}

/**
 * Render the extension details panel
 */
export function renderExtensionDetails(ui: UIComponents, state: BrowserState): void {
  if (state.extensionsList.length === 0) {
    ui.previewContent.setContent('{blue-fg}No extensions{/blue-fg}');
    return;
  }

  const ext = state.extensionsList[state.selectedExtensionIndex];
  if (!ext) {
    ui.previewContent.setContent('{blue-fg}Select an extension{/blue-fg}');
    return;
  }

  const lines: string[] = [];
  const previewWidth = (ui.previewContent.width as number) - 2;

  // Header
  lines.push(`{bold}${truncate(escapeForBlessed(ext.name), previewWidth)}{/bold}`);
  lines.push(`{blue-fg}v${escapeForBlessed(ext.version)}{/blue-fg}`);
  lines.push('');

  // Status
  const statusColor = ext.enabled ? 'green' : 'red';
  const statusText = ext.enabled ? 'Enabled' : 'Disabled';
  lines.push(`{${statusColor}-fg}Status: ${statusText}{/${statusColor}-fg}`);
  lines.push('');

  // Hooks
  lines.push('{cyan-fg}Hooks:{/cyan-fg}');
  if (ext.hooks.length === 0) {
    lines.push('  {blue-fg}(none){/blue-fg}');
  } else {
    for (const hook of ext.hooks) {
      lines.push(`  {green-fg}*{/green-fg} ${escapeForBlessed(hook)}`);
    }
  }
  lines.push('');

  // Middleware
  lines.push('{cyan-fg}Middleware:{/cyan-fg}');
  if (ext.middleware.length === 0) {
    lines.push('  {blue-fg}(none){/blue-fg}');
  } else {
    for (const mw of ext.middleware) {
      lines.push(`  {green-fg}*{/green-fg} ${escapeForBlessed(mw)}`);
    }
  }
  lines.push('');

  // Commands
  lines.push('{cyan-fg}Commands:{/cyan-fg}');
  if (ext.commands.length === 0) {
    lines.push('  {blue-fg}(none){/blue-fg}');
  } else {
    for (const cmd of ext.commands) {
      lines.push(`  {green-fg}*{/green-fg} ${escapeForBlessed(cmd)}`);
    }
  }
  lines.push('');

  // Permissions
  lines.push('{cyan-fg}Permissions:{/cyan-fg}');
  if (!ext.permissions) {
    lines.push('  {blue-fg}read: true (default){/blue-fg}');
  } else {
    const perms = ext.permissions;
    lines.push(`  read: ${perms.read !== false ? 'true' : 'false'}`);
    if (perms.proposeCreate) lines.push('  proposeCreate: true');
    if (perms.proposeModify) lines.push('  proposeModify: true');
    if (perms.proposeDelete) lines.push('  proposeDelete: true');
  }
  lines.push('');

  // Instructions
  lines.push('{blue-fg}Press Enter to toggle enabled/disabled{/blue-fg}');

  ui.previewContent.setContent(lines.join('\n'));
}
