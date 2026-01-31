/**
 * Tool-related rendering functions for the Lore Document Browser TUI
 *
 * Handles rendering of tool lists, forms, and results.
 */

import type { BrowserState, UIComponents } from './browse-types.js';
import { escapeForBlessed, truncate, formatJsonForPreview } from './browse-render.js';

function formatToolFormValue(fieldType: 'string' | 'number' | 'boolean', value: unknown): string {
  if (fieldType === 'boolean') {
    return value ? '[x]' : '[ ]';
  }
  const text = value === undefined || value === null ? '' : String(value);
  return `[${escapeForBlessed(text)}]`;
}

/**
 * Render the tool form overlay
 */
export function renderToolForm(ui: UIComponents, state: BrowserState): void {
  const width = (ui.toolFormContent.width as number) - 2;
  const lines: string[] = [];

  if (state.toolFormFields.length === 0) {
    lines.push('{blue-fg}No input fields for this tool.{/blue-fg}');
    lines.push('');
    lines.push('{blue-fg}[Enter: run]  [Esc: back]{/blue-fg}');
    ui.toolFormContent.setContent(lines.join('\n'));
    return;
  }

  for (let i = 0; i < state.toolFormFields.length; i++) {
    const field = state.toolFormFields[i];
    const isFocused = i === state.toolFormIndex;
    const name = escapeForBlessed(field.name);
    const reqLabel = field.required ? '{red-fg}(required){/red-fg}' : '{green-fg}(optional){/green-fg}';
    const valueText = formatToolFormValue(field.type, field.value);
    const line = truncate(`${name}: ${valueText} ${reqLabel}`, width);
    lines.push(isFocused ? `{inverse}${line}{/inverse}` : line);

    if (field.description) {
      const hint = truncate(escapeForBlessed(field.description), Math.max(0, width - 2));
      lines.push(`  {blue-fg}${hint}{/blue-fg}`);
    }
    lines.push('');
  }

  lines.push('{blue-fg}[Tab: next field]  [Shift+Tab: prev]  [Enter: run]  [Esc: back]{/blue-fg}');

  ui.toolFormContent.setContent(lines.join('\n'));
}

/**
 * Render the tools list
 */
export function renderToolsList(ui: UIComponents, state: BrowserState): void {
  const width = (ui.listContent.width as number) - 2;
  const height = (ui.listContent.height as number) - 1;
  const lines: string[] = [];

  if (state.toolsList.length === 0) {
    lines.push('');
    lines.push('{blue-fg}  No tools available{/blue-fg}');
    lines.push('');
    lines.push('{blue-fg}  Install extensions with tools{/blue-fg}');
    ui.listContent.setContent(lines.join('\n'));
    return;
  }

  const visibleStart = Math.max(0, state.selectedToolIndex - Math.floor(height / 3));
  const visibleEnd = Math.min(state.toolsList.length, visibleStart + height);

  for (let i = visibleStart; i < visibleEnd; i++) {
    const tool = state.toolsList[i];
    const isSelected = i === state.selectedToolIndex;
    const accent = isSelected ? '{cyan-fg}▌{/cyan-fg}' : ' ';

    const name = truncate(tool.name, width - 4);
    const description = truncate(tool.description || '', width - 6);

    lines.push(`${accent} {bold}${escapeForBlessed(name)}{/bold}`);
    if (description) {
      lines.push(`${accent}   {cyan-fg}${escapeForBlessed(description)}{/cyan-fg}`);
    }
    lines.push('');
  }

  ui.listContent.setContent(lines.join('\n'));
}

/**
 * Format tool result in a human-readable way
 */
function formatToolResultNicely(result: unknown, maxWidth: number): string[] {
  const lines: string[] = [];
  
  if (result === null || result === undefined) {
    lines.push('{blue-fg}(no result){/blue-fg}');
    return lines;
  }
  
  if (typeof result !== 'object') {
    lines.push(escapeForBlessed(String(result)));
    return lines;
  }
  
  const obj = result as Record<string, unknown>;
  
  // Handle running state
  if ('status' in obj && obj.status === 'running') {
    lines.push('{yellow-fg}⏳ Running...{/yellow-fg}');
    if ('message' in obj) {
      lines.push(`{cyan-fg}${escapeForBlessed(String(obj.message))}{/cyan-fg}`);
    }
    return lines;
  }
  
  // Handle common patterns
  if ('status' in obj && obj.status === 'ok') {
    lines.push(`{green-fg}Status:{/green-fg} ${escapeForBlessed(String(obj.status))}`);
  }
  
  if ('status' in obj && obj.status === 'error') {
    lines.push(`{red-fg}Status:{/red-fg} error`);
  }
  
  if ('message' in obj && obj.status !== 'running') {
    lines.push(`{cyan-fg}Message:{/cyan-fg} ${escapeForBlessed(String(obj.message))}`);
  }
  
  // Handle proposal notification
  if ('proposal_id' in obj) {
    lines.push('');
    lines.push(`{yellow-fg}📋 Proposal created:{/yellow-fg} ${escapeForBlessed(String(obj.proposal_id))}`);
    if ('proposal_note' in obj) {
      lines.push(`{yellow-fg}${escapeForBlessed(String(obj.proposal_note))}{/yellow-fg}`);
    }
    lines.push(`{yellow-fg}Press 'P' to review and approve{/yellow-fg}`);
  }
  
  // Handle analysis output
  if ('analysis' in obj) {
    lines.push('');
    lines.push('{cyan-fg}Analysis:{/cyan-fg}');
    const analysisText = String(obj.analysis);
    // Wrap long analysis text
    const analysisLines = analysisText.split('\n');
    for (const line of analysisLines.slice(0, 30)) {  // Limit to 30 lines
      lines.push(escapeForBlessed(truncate(line, maxWidth)));
    }
    if (analysisLines.length > 30) {
      lines.push('{blue-fg}... (truncated){/blue-fg}');
    }
  }
  
  if ('total_sources_analyzed' in obj) {
    lines.push(`{cyan-fg}Sources analyzed:{/cyan-fg} ${obj.total_sources_analyzed}`);
  }
  
  if ('total_speakers' in obj) {
    lines.push(`{cyan-fg}Total speakers:{/cyan-fg} ${obj.total_speakers}`);
  }
  
  if ('top_pain_point' in obj) {
    lines.push(`{cyan-fg}Top pain point:{/cyan-fg} ${escapeForBlessed(String(obj.top_pain_point))}`);
  }
  
  if ('verdict' in obj) {
    const verdict = String(obj.verdict);
    const color = verdict === 'SUPPORTED' ? 'green' : verdict === 'CONTRADICTED' ? 'red' : 'yellow';
    lines.push(`{${color}-fg}Verdict:{/${color}-fg} ${verdict}`);
  }
  
  if ('confidence' in obj) {
    lines.push(`{cyan-fg}Confidence:{/cyan-fg} ${escapeForBlessed(String(obj.confidence))}`);
  }
  
  if ('coverage_note' in obj && obj.coverage_note) {
    lines.push('');
    lines.push(`{yellow-fg}⚠ ${escapeForBlessed(String(obj.coverage_note))}{/yellow-fg}`);
  }
  
  if ('features_tested' in obj && Array.isArray(obj.features_tested)) {
    lines.push('');
    lines.push('{cyan-fg}Features tested:{/cyan-fg}');
    for (const feature of obj.features_tested) {
      lines.push(`  • ${escapeForBlessed(String(feature))}`);
    }
  }
  
  if ('pain_points' in obj && Array.isArray(obj.pain_points)) {
    const painPoints = obj.pain_points as Array<{ category?: string; frequency?: number }>;
    if (painPoints.length > 0) {
      lines.push('');
      lines.push('{cyan-fg}Pain points:{/cyan-fg}');
      for (const pp of painPoints.slice(0, 5)) {
        lines.push(`  • ${escapeForBlessed(pp.category || 'Unknown')} (${pp.frequency || 0}x)`);
      }
    }
  }
  
  if ('profiles' in obj && Array.isArray(obj.profiles)) {
    const profiles = obj.profiles as Array<{ name?: string; appearances?: number }>;
    if (profiles.length > 0) {
      lines.push('');
      lines.push('{cyan-fg}Speakers:{/cyan-fg}');
      for (const p of profiles.slice(0, 5)) {
        lines.push(`  • ${escapeForBlessed(p.name || 'Unknown')} (${p.appearances || 0} appearances)`);
      }
    }
  }
  
  if ('supporting' in obj && Array.isArray(obj.supporting)) {
    const supporting = obj.supporting as Array<{ source?: string }>;
    if (supporting.length > 0) {
      lines.push('');
      lines.push(`{green-fg}Supporting evidence:{/green-fg} ${supporting.length} sources`);
      for (const s of supporting.slice(0, 3)) {
        lines.push(`  • ${escapeForBlessed(s.source || 'Unknown source')}`);
      }
    }
  }
  
  if ('contradicting' in obj && Array.isArray(obj.contradicting)) {
    const contradicting = obj.contradicting as Array<{ source?: string }>;
    if (contradicting.length > 0) {
      lines.push('');
      lines.push(`{red-fg}Contradicting evidence:{/red-fg} ${contradicting.length} sources`);
      for (const c of contradicting.slice(0, 3)) {
        lines.push(`  • ${escapeForBlessed(c.source || 'Unknown source')}`);
      }
    }
  }
  
  // If we didn't format anything special, fall back to JSON
  if (lines.length === 0) {
    const jsonText = formatJsonForPreview(result);
    for (const line of jsonText.split('\n')) {
      lines.push(truncate(escapeForBlessed(line), maxWidth));
    }
  }
  
  return lines;
}

/**
 * Render the tool preview (schema + result)
 */
export function renderToolResult(ui: UIComponents, state: BrowserState): void {
  if (state.toolsList.length === 0) {
    ui.previewContent.setContent('{blue-fg}No tools{/blue-fg}');
    return;
  }

  const tool = state.toolsList[state.selectedToolIndex];
  if (!tool) {
    ui.previewContent.setContent('{blue-fg}Select a tool{/blue-fg}');
    return;
  }

  const lines: string[] = [];
  const previewWidth = (ui.previewContent.width as number) - 2;

  lines.push(`{bold}${truncate(escapeForBlessed(tool.name), previewWidth)}{/bold}`);
  if (tool.description) {
    lines.push(escapeForBlessed(tool.description));
  }

  lines.push('');
  lines.push('{cyan-fg}Input Schema{/cyan-fg}');
  lines.push('{cyan-fg}─────────────────────────────────{/cyan-fg}');
  const schemaText = formatJsonForPreview(tool.inputSchema);
  for (const line of schemaText.split('\n')) {
    lines.push(truncate(escapeForBlessed(line), previewWidth));
  }

  const matchingResult = state.toolResult && state.toolResult.toolName === tool.name
    ? state.toolResult
    : null;

  if (matchingResult) {
    lines.push('');
    if (matchingResult.ok) {
      lines.push('{green-fg}✓ Result{/green-fg}');
      lines.push('{cyan-fg}─────────────────────────────────{/cyan-fg}');
      const formattedResult = formatToolResultNicely(matchingResult.result, previewWidth);
      lines.push(...formattedResult);
    } else {
      lines.push('{red-fg}✗ Error{/red-fg}');
      lines.push('{cyan-fg}─────────────────────────────────{/cyan-fg}');
      lines.push(`{red-fg}${escapeForBlessed(String(matchingResult.result))}{/red-fg}`);
    }
  } else if (state.toolRunning) {
    lines.push('');
    lines.push('{yellow-fg}⏳ Running...{/yellow-fg}');
  } else {
    lines.push('');
    lines.push('{cyan-fg}Press Enter to run tool{/cyan-fg}');
  }

  ui.previewContent.setContent(lines.join('\n'));
}
