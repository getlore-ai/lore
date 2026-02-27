/**
 * Browse Render - Preview
 *
 * Preview pane, full-view rendering, search highlighting, and scrollbar.
 */

import type { SourceItem, BrowserState, UIComponents } from './browse-types.js';
import { formatDate, truncate, escapeForBlessed } from './browse-render-utils.js';
import { getSelectedSource } from './browse-render-list.js';

/**
 * Render the preview pane
 */
export function renderPreview(ui: UIComponents, state: BrowserState): void {
  if (state.filtered.length === 0) {
    ui.previewContent.setContent('{blue-fg}No documents{/blue-fg}');
    return;
  }

  const lines: string[] = [];
  const previewWidth = (ui.previewContent.width as number) - 2;

  // Handle grouped view
  if (state.groupByProject && state.listItems.length > 0) {
    const item = state.listItems[state.selectedIndex];

    if (!item) {
      ui.previewContent.setContent('{blue-fg}No selection{/blue-fg}');
      return;
    }

    if (item.type === 'header') {
      // Show project info
      lines.push(`{bold}{yellow-fg}${item.displayName}{/yellow-fg}{/bold}`);
      lines.push('');
      lines.push(`{cyan-fg}${item.documentCount} document${item.documentCount !== 1 ? 's' : ''}{/cyan-fg}`);
      lines.push('');
      lines.push('{cyan-fg}─────────────────────────────────{/cyan-fg}');
      lines.push('');
      if (item.expanded) {
        lines.push('{blue-fg}Press Space to collapse{/blue-fg}');
      } else {
        lines.push('{blue-fg}Press Space to expand{/blue-fg}');
      }
      ui.previewContent.setContent(lines.join('\n'));
      return;
    }

    // It's a document
    renderDocumentPreview(item.source, previewWidth, lines);
    ui.previewContent.setContent(lines.join('\n'));
    return;
  }

  // Flat view
  const source = state.filtered[state.selectedIndex];
  if (!source) return;

  renderDocumentPreview(source, previewWidth, lines);
  ui.previewContent.setContent(lines.join('\n'));
}

/**
 * Render document preview content
 */
function renderDocumentPreview(source: SourceItem, previewWidth: number, lines: string[]): void {
  // Title
  lines.push(`{bold}${truncate(source.title, previewWidth)}{/bold}`);
  lines.push('');

  // Metadata
  const date = formatDate(source.created_at);
  const type = source.content_type || source.source_type;
  const project = source.projects[0] || '';
  lines.push(`{cyan-fg}${date}  ·  ${type}${project ? `  ·  ${project}` : ''}{/cyan-fg}`);

  // Show similarity score if from search
  if (source.score !== undefined) {
    const pct = Math.round(source.score * 100);
    const filled = Math.round(pct / 10);
    const bar = '●'.repeat(filled) + '○'.repeat(10 - filled);
    lines.push(`{cyan-fg}${bar} ${pct}% match{/cyan-fg}`);
  }

  lines.push('');
  lines.push('{cyan-fg}─────────────────────────────────{/cyan-fg}');
  lines.push('');

  // Summary with word wrap
  const words = source.summary.split(' ');
  let currentLine = '';

  for (const word of words) {
    if (currentLine.length + word.length + 1 > previewWidth) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = currentLine ? `${currentLine} ${word}` : word;
    }
  }
  if (currentLine) lines.push(currentLine);

  lines.push('');
  lines.push('{cyan-fg}Press Enter to view full document{/cyan-fg}');
}

function highlightMatchesInLine(rawLine: string, pattern: string, isCurrentMatch: boolean): string {
  try {
    const regex = new RegExp(`(${pattern})`, 'gi');
    const highlightTag = isCurrentMatch
      ? '{yellow-bg}{black-fg}'
      : '{cyan-bg}{black-fg}';
    const closeTag = isCurrentMatch
      ? '{/black-fg}{/yellow-bg}'
      : '{/black-fg}{/cyan-bg}';

    // Escape the line for blessed first
    let escaped = escapeForBlessed(rawLine);

    // Then apply highlights to the escaped content
    // We need to match on the original escaped text
    escaped = escaped.replace(regex, `${highlightTag}$1${closeTag}`);

    return escaped;
  } catch {
    return escapeForBlessed(rawLine);
  }
}

/**
 * Build scrollbar content as a vertical string
 */
function buildScrollbarContent(
  visibleHeight: number,
  totalLines: number,
  scrollOffset: number
): string {
  // If content fits in view, no scrollbar needed
  if (totalLines <= visibleHeight) {
    return '';
  }

  // Calculate thumb size (minimum 1 line)
  const thumbSize = Math.max(1, Math.round((visibleHeight / totalLines) * visibleHeight));

  // Calculate thumb position
  const maxScroll = totalLines - visibleHeight;
  const scrollRatio = maxScroll > 0 ? scrollOffset / maxScroll : 0;
  const thumbStart = Math.round(scrollRatio * (visibleHeight - thumbSize));
  const thumbEnd = thumbStart + thumbSize;

  // Build scrollbar as array of lines
  const lines: string[] = [];
  for (let i = 0; i < visibleHeight; i++) {
    if (i >= thumbStart && i < thumbEnd) {
      lines.push('{blue-fg}█{/blue-fg}'); // Thumb
    } else {
      lines.push('{blue-fg}│{/blue-fg}'); // Track
    }
  }
  return lines.join('\n');
}

/**
 * Render the full view pane
 */
export function renderFullView(ui: UIComponents, state: BrowserState): void {
  // Update title header with document info
  const source = getSelectedSource(state);
  if (source) {
    const date = formatDate(source.created_at);
    const type = source.content_type || source.source_type;
    const project = source.projects[0] || '';
    const titleWidth = (ui.fullViewTitle.width as number) - 2;

    const titleLines: string[] = [];
    titleLines.push(`{bold}${truncate(source.title, titleWidth)}{/bold}`);
    titleLines.push(`{cyan-fg}${date}  ·  ${type}${project ? `  ·  ${project}` : ''}{/cyan-fg}`);
    titleLines.push('{blue-fg}' + '─'.repeat(Math.min(50, titleWidth)) + '{/blue-fg}');
    ui.fullViewTitle.setContent(titleLines.join('\n'));
  }

  const height = (ui.fullViewContent.height as number) - 1;

  // Get visible line range
  const startLine = state.scrollOffset;
  const endLine = Math.min(startLine + height, state.fullContentLines.length);
  const totalLines = state.fullContentLines.length;

  const visible: string[] = [];

  for (let lineIndex = 0; lineIndex < endLine - startLine; lineIndex++) {
    const lineNum = startLine + lineIndex;
    const isMatchLine = state.docSearchMatches.includes(lineNum);
    const isCurrentMatch = state.docSearchMatches[state.docSearchCurrentIdx] === lineNum;

    let lineContent: string;
    if (state.docSearchPattern && isMatchLine) {
      // Get raw line and highlight matches within it
      const rawLine = state.fullContentLinesRaw[lineNum] || '';
      lineContent = highlightMatchesInLine(rawLine, state.docSearchPattern, isCurrentMatch);
    } else {
      // No search or non-matching line - render normally
      lineContent = state.fullContentLines[lineNum];
    }

    visible.push(lineContent);
  }

  ui.fullViewContent.setContent(visible.join('\n'));

  // Update scrollbar (separate element on right edge)
  const scrollbarContent = buildScrollbarContent(height, totalLines, state.scrollOffset);
  ui.fullViewScrollbar.setContent(scrollbarContent);
  // Show/hide scrollbar based on whether content is scrollable
  if (totalLines > height) {
    ui.fullViewScrollbar.show();
  } else {
    ui.fullViewScrollbar.hide();
  }

  // Update footer for full view mode with scroll position
  const currentLine = state.scrollOffset + 1;
  const lastVisibleLine = Math.min(state.scrollOffset + height, totalLines);
  const positionInfo = totalLines > height ? `{cyan-fg}${currentLine}-${lastVisibleLine}/${totalLines}{/cyan-fg} ` : '';

  let footerText = ` ${positionInfo}j/k: scroll  /: search  e: editor  Esc: back`;
  if (state.docSearchPattern && state.docSearchMatches.length > 0) {
    footerText = ` ${positionInfo}[${state.docSearchCurrentIdx + 1}/${state.docSearchMatches.length}] n/N: next/prev  /: new search  Esc: clear`;
  } else if (state.docSearchPattern && state.docSearchMatches.length === 0) {
    footerText = ` ${positionInfo}No matches for "${state.docSearchPattern}"  /: new search  Esc: clear`;
  }
  ui.footer.setContent(footerText);
  ui.screen.render();
}
