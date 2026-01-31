/**
 * Tool handlers for the Lore Document Browser TUI
 *
 * Handles tool listing, form display, and execution.
 */

import type { BrowserState, UIComponents, ToolFormField } from './browse-types.js';
import { renderToolsList, renderToolForm, renderToolResult } from './browse-render-tools.js';
import { getExtensionRegistry } from '../extensions/registry.js';

/**
 * Parse tool input schema into form fields
 */
export function parseInputSchema(inputSchema: Record<string, unknown>): ToolFormField[] {
  if (!inputSchema || typeof inputSchema !== 'object') return [];

  const schema = inputSchema as {
    type?: string;
    properties?: Record<string, unknown>;
    required?: string[];
  };
  const properties = schema.properties && typeof schema.properties === 'object'
    ? schema.properties as Record<string, any>
    : {};
  const required = Array.isArray(schema.required) ? schema.required : [];

  const fields: ToolFormField[] = [];

  for (const [name, prop] of Object.entries(properties)) {
    const propType = typeof prop === 'object' && prop ? prop.type : undefined;
    let type: ToolFormField['type'] = 'string';
    if (propType === 'number' || propType === 'integer') {
      type = 'number';
    } else if (propType === 'boolean') {
      type = 'boolean';
    } else if (propType === 'string') {
      type = 'string';
    }

    const description = typeof prop?.description === 'string' ? prop.description : '';
    const defaultValue = prop?.default;

    let value: ToolFormField['value'];
    if (defaultValue !== undefined) {
      if (type === 'boolean') {
        value = Boolean(defaultValue);
      } else if (type === 'number') {
        const numeric = typeof defaultValue === 'number' ? defaultValue : Number(defaultValue);
        value = Number.isNaN(numeric) ? '' : numeric;
      } else {
        value = String(defaultValue);
      }
    } else if (type === 'boolean') {
      value = false;
    } else {
      value = '';
    }

    fields.push({
      name,
      type,
      description,
      default: defaultValue,
      required: required.includes(name),
      value,
    });
  }

  return fields;
}

function setToolFormFields(state: BrowserState, tool?: { inputSchema?: Record<string, unknown> }): void {
  if (!tool || !tool.inputSchema) {
    state.toolFormFields = [];
    state.toolFormIndex = 0;
    return;
  }
  state.toolFormFields = parseInputSchema(tool.inputSchema);
  state.toolFormIndex = 0;
}

/**
 * Show the tools list view
 */
export async function showTools(state: BrowserState, ui: UIComponents): Promise<void> {
  state.mode = 'tools';
  state.toolResult = null;
  ui.toolForm.hide();
  ui.fullViewPane.hide();
  ui.listPane.show();
  ui.previewPane.show();
  ui.listTitle.setContent(' Tools');
  ui.previewTitle.setContent(' Tool Details');
  ui.footer.setContent(' j/k: navigate  Enter: run  Esc: back  q: quit');
  ui.statusBar.setContent(' Loading tools...');
  ui.screen.render();

  try {
    const registry = await getExtensionRegistry();
    state.toolsList = registry.getToolDefinitions();
    state.selectedToolIndex = 0;
    ui.statusBar.setContent(` ${state.toolsList.length} tool${state.toolsList.length !== 1 ? 's' : ''}`);
    setToolFormFields(state, state.toolsList[state.selectedToolIndex]);
  } catch (error) {
    state.toolsList = [];
    state.selectedToolIndex = 0;
    state.toolFormFields = [];
    state.toolFormIndex = 0;
    ui.statusBar.setContent(` {red-fg}Failed to load tools: ${error}{/red-fg}`);
  }

  renderToolsList(ui, state);
  renderToolResult(ui, state);
  ui.listContent.focus();
  ui.screen.render();
}

/**
 * Update tool selection and refresh display
 */
export function selectTool(state: BrowserState, ui: UIComponents): void {
  const tool = state.toolsList[state.selectedToolIndex];
  setToolFormFields(state, tool);
  renderToolsList(ui, state);
  renderToolResult(ui, state);
  if (!ui.toolForm.hidden) {
    renderToolForm(ui, state);
  }
  ui.screen.render();
}

/**
 * Show the tool input form
 */
export function showToolForm(state: BrowserState, ui: UIComponents): void {
  const tool = state.toolsList[state.selectedToolIndex];
  if (!tool) return;

  setToolFormFields(state, tool);
  ui.toolForm.setLabel(` ${tool.name} `);
  ui.toolForm.show();
  renderToolForm(ui, state);
  ui.footer.setContent(' Tab: next field  Enter: run  Esc: back');
  ui.screen.render();
}

/**
 * Hide the tool input form
 */
export function hideToolForm(state: BrowserState, ui: UIComponents): void {
  ui.toolForm.hide();
  ui.footer.setContent(' j/k: navigate  Enter: run  Esc: back  q: quit');
  ui.screen.render();
}

/**
 * Move to next form field
 */
export function formFieldNext(state: BrowserState, ui: UIComponents): void {
  if (state.toolFormFields.length === 0) return;
  state.toolFormIndex = (state.toolFormIndex + 1) % state.toolFormFields.length;
  renderToolForm(ui, state);
  ui.screen.render();
}

/**
 * Move to previous form field
 */
export function formFieldPrev(state: BrowserState, ui: UIComponents): void {
  if (state.toolFormFields.length === 0) return;
  state.toolFormIndex = (state.toolFormIndex - 1 + state.toolFormFields.length) % state.toolFormFields.length;
  renderToolForm(ui, state);
  ui.screen.render();
}

/**
 * Update current form field value
 */
export function formFieldUpdate(state: BrowserState, ui: UIComponents, value: ToolFormField['value']): void {
  const field = state.toolFormFields[state.toolFormIndex];
  if (!field) return;
  field.value = value;
  renderToolForm(ui, state);
  ui.screen.render();
}

/**
 * Execute the selected tool with current form values
 */
export async function callTool(
  state: BrowserState,
  ui: UIComponents,
  dbPath: string,
  dataDir: string
): Promise<boolean> {
  const tool = state.toolsList[state.selectedToolIndex];
  if (!tool) return false;

  const args: Record<string, unknown> = {};
  const missing: string[] = [];

  for (const field of state.toolFormFields) {
    if (field.type === 'boolean') {
      const value = Boolean(field.value);
      if (value || field.required || field.default !== undefined) {
        args[field.name] = value;
      }
      continue;
    }

    if (field.type === 'number') {
      const raw = field.value === undefined || field.value === null ? '' : String(field.value);
      if (!raw.trim()) {
        if (field.required) missing.push(field.name);
        continue;
      }
      const numeric = Number(raw);
      if (Number.isNaN(numeric)) {
        state.toolResult = {
          toolName: tool.name,
          ok: false,
          result: `Invalid number for "${field.name}"`,
        };
        renderToolResult(ui, state);
        ui.screen.render();
        return false;
      }
      args[field.name] = numeric;
      continue;
    }

    const text = field.value === undefined || field.value === null ? '' : String(field.value);
    if (!text.trim()) {
      if (field.required) missing.push(field.name);
      continue;
    }
    args[field.name] = text;
  }

  if (missing.length > 0) {
    state.toolResult = {
      toolName: tool.name,
      ok: false,
      result: `Missing required field(s): ${missing.join(', ')}`,
    };
    renderToolResult(ui, state);
    ui.screen.render();
    return false;
  }

  state.toolRunning = true;
  state.toolStartTime = Date.now();
  
  // Hide form and show running state clearly
  ui.toolForm.hide();
  ui.statusBar.setContent(` ⏳ Running ${tool.name}... (this may take a moment)`);
  state.toolResult = {
    toolName: tool.name,
    ok: true,
    result: { status: 'running', message: 'Please wait...' },
  };
  renderToolResult(ui, state);
  ui.screen.render();

  try {
    const registry = await getExtensionRegistry();
    const result = await registry.handleToolCall(tool.name, args, {
      mode: 'cli',
      dataDir,
      dbPath,
      // Silence extension logs in TUI mode
      logger: () => {},
    });

    state.toolRunning = false;
    state.toolStartTime = null;

    if (!result.handled) {
      state.toolResult = {
        toolName: tool.name,
        ok: false,
        result: 'Tool not found',
      };
      ui.statusBar.setContent(` {red-fg}✗ ${tool.name}: Tool not found{/red-fg}`);
    } else {
      state.toolResult = {
        toolName: tool.name,
        ok: true,
        result: result.result,
      };
      
      // Check if result contains a proposal - notify user
      const resultObj = result.result as Record<string, unknown> | null;
      if (resultObj && typeof resultObj === 'object' && 'proposal_id' in resultObj) {
        ui.statusBar.setContent(` {green-fg}✓ ${tool.name} complete{/green-fg} — {yellow-fg}Press 'P' to review pending proposal{/yellow-fg}`);
      } else {
        ui.statusBar.setContent(` {green-fg}✓ ${tool.name} complete{/green-fg}`);
      }
    }
  } catch (error) {
    state.toolRunning = false;
    state.toolStartTime = null;
    state.toolResult = {
      toolName: tool.name,
      ok: false,
      result: error instanceof Error ? error.message : String(error),
    };
    ui.statusBar.setContent(` {red-fg}✗ ${tool.name} failed{/red-fg}`);
  }

  renderToolResult(ui, state);
  ui.screen.render();
  return true;
}
