/**
 * Extension handlers for the Lore Document Browser TUI
 *
 * Handles extension listing and display.
 */

import type { BrowserState, UIComponents, LoadedExtensionInfo } from './browse-types.js';
import { renderExtensionsList, renderExtensionDetails } from './browse-render-extensions.js';
import { getExtensionRegistry } from '../extensions/registry.js';
import { loadExtensionConfig, addExtensionToConfig } from '../extensions/config.js';

/**
 * Show the extensions list view
 */
export async function showExtensions(state: BrowserState, ui: UIComponents): Promise<void> {
  state.mode = 'extensions';
  ui.fullViewPane.hide();
  ui.listPane.show();
  ui.previewPane.show();
  ui.listTitle.setContent(' Extensions');
  ui.previewTitle.setContent(' Extension Details');
  ui.footer.setContent(' j/k: navigate  Enter: toggle  Esc: back  q: quit');
  ui.statusBar.setContent(' Loading extensions...');
  ui.screen.render();

  try {
    const registry = await getExtensionRegistry();
    const config = await loadExtensionConfig();
    const loaded = registry.listExtensions();

    // Build extension info list
    const extensionsList: LoadedExtensionInfo[] = loaded.map((ext) => {
      const configEntry = config.extensions.find((e) => e.name === ext.packageName);
      const hooks: string[] = [];
      if (ext.extension.hooks?.onSourceCreated) hooks.push('onSourceCreated');
      if (ext.extension.hooks?.onResearchCompleted) hooks.push('onResearchCompleted');
      if (ext.extension.hooks?.onSyncCompleted) hooks.push('onSyncCompleted');

      const middleware = (ext.extension.middleware || []).map((m) => m.name);
      const commands = (ext.extension.commands || []).map((c) => c.name);

      return {
        name: ext.extension.name,
        version: ext.extension.version,
        packageName: ext.packageName,
        enabled: configEntry?.enabled !== false,
        hooks,
        middleware,
        commands,
        permissions: ext.extension.permissions,
      };
    });

    // Also include disabled extensions from config that aren't loaded
    for (const configEntry of config.extensions) {
      if (!extensionsList.some((e) => e.packageName === configEntry.name)) {
        extensionsList.push({
          name: configEntry.name,
          version: configEntry.version || 'unknown',
          packageName: configEntry.name,
          enabled: false,
          hooks: [],
          middleware: [],
          commands: [],
        });
      }
    }

    state.extensionsList = extensionsList;
    state.selectedExtensionIndex = 0;
    ui.statusBar.setContent(
      ` ${extensionsList.length} extension${extensionsList.length !== 1 ? 's' : ''}`
    );
  } catch (error) {
    state.extensionsList = [];
    state.selectedExtensionIndex = 0;
    ui.statusBar.setContent(` {red-fg}Failed to load extensions: ${error}{/red-fg}`);
  }

  renderExtensionsList(ui, state);
  renderExtensionDetails(ui, state);
  ui.listContent.focus();
  ui.screen.render();
}

/**
 * Update extension selection and refresh display
 */
export function selectExtension(state: BrowserState, ui: UIComponents): void {
  renderExtensionsList(ui, state);
  renderExtensionDetails(ui, state);
  ui.screen.render();
}

/**
 * Toggle the selected extension's enabled state
 */
export async function toggleExtension(state: BrowserState, ui: UIComponents): Promise<void> {
  const ext = state.extensionsList[state.selectedExtensionIndex];
  if (!ext) return;

  const newEnabled = !ext.enabled;

  ui.statusBar.setContent(` ${newEnabled ? 'Enabling' : 'Disabling'} ${ext.name}...`);
  ui.screen.render();

  try {
    await addExtensionToConfig(ext.packageName, ext.version, newEnabled);
    ext.enabled = newEnabled;
    ui.statusBar.setContent(
      ` ${newEnabled ? 'Enabled' : 'Disabled'} ${ext.name} (restart to apply)`
    );
    renderExtensionsList(ui, state);
    renderExtensionDetails(ui, state);
    ui.screen.render();
  } catch (error) {
    ui.statusBar.setContent(` {red-fg}Failed: ${error}{/red-fg}`);
    ui.screen.render();
  }
}
