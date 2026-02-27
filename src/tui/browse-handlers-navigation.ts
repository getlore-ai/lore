/**
 * Browse Handlers - Navigation
 *
 * Movement: up/down, page up/down, jump to start/end.
 */

import type { BrowserState, UIComponents } from './browse-types.js';
import { renderFullView, renderList, renderPreview } from './browse-render.js';

export function moveDown(state: BrowserState, ui: UIComponents): void {
  if (state.mode === 'fullview') {
    const maxScroll = Math.max(0, state.fullContentLines.length - ((ui.fullViewContent.height as number) - 1));
    state.scrollOffset = Math.min(state.scrollOffset + 1, maxScroll);
    renderFullView(ui, state);
  } else if (state.mode === 'list') {
    const maxIndex = state.groupByProject
      ? state.listItems.length - 1
      : state.filtered.length - 1;
    if (state.selectedIndex < maxIndex) {
      state.selectedIndex++;
      renderList(ui, state);
      renderPreview(ui, state);
    }
  }
  ui.screen.render();
}

export function moveUp(state: BrowserState, ui: UIComponents): void {
  if (state.mode === 'fullview') {
    state.scrollOffset = Math.max(0, state.scrollOffset - 1);
    renderFullView(ui, state);
  } else if (state.mode === 'list') {
    if (state.selectedIndex > 0) {
      state.selectedIndex--;
      renderList(ui, state);
      renderPreview(ui, state);
    }
  }
  ui.screen.render();
}

export function pageDown(state: BrowserState, ui: UIComponents): void {
  const pageSize = state.mode === 'fullview'
    ? (ui.fullViewContent.height as number) - 2
    : (ui.listContent.height as number) / 3;

  if (state.mode === 'fullview') {
    const maxScroll = Math.max(0, state.fullContentLines.length - ((ui.fullViewContent.height as number) - 1));
    state.scrollOffset = Math.min(state.scrollOffset + pageSize, maxScroll);
    renderFullView(ui, state);
  } else if (state.mode === 'list') {
    const maxIndex = state.groupByProject
      ? state.listItems.length - 1
      : state.filtered.length - 1;
    state.selectedIndex = Math.min(state.selectedIndex + Math.floor(pageSize), maxIndex);
    renderList(ui, state);
    renderPreview(ui, state);
  }
  ui.screen.render();
}

export function pageUp(state: BrowserState, ui: UIComponents): void {
  const pageSize = state.mode === 'fullview'
    ? (ui.fullViewContent.height as number) - 2
    : (ui.listContent.height as number) / 3;

  if (state.mode === 'fullview') {
    state.scrollOffset = Math.max(0, state.scrollOffset - pageSize);
    renderFullView(ui, state);
  } else if (state.mode === 'list') {
    state.selectedIndex = Math.max(state.selectedIndex - Math.floor(pageSize), 0);
    renderList(ui, state);
    renderPreview(ui, state);
  }
  ui.screen.render();
}

export function jumpToEnd(state: BrowserState, ui: UIComponents): void {
  if (state.mode === 'fullview') {
    state.scrollOffset = Math.max(0, state.fullContentLines.length - ((ui.fullViewContent.height as number) - 1));
    renderFullView(ui, state);
  } else if (state.mode === 'list') {
    const maxIndex = state.groupByProject
      ? state.listItems.length - 1
      : state.filtered.length - 1;
    state.selectedIndex = maxIndex;
    renderList(ui, state);
    renderPreview(ui, state);
  }
  ui.screen.render();
}

export function jumpToStart(state: BrowserState, ui: UIComponents): void {
  if (state.mode === 'fullview') {
    state.scrollOffset = 0;
    renderFullView(ui, state);
  } else if (state.mode === 'list') {
    state.selectedIndex = 0;
    renderList(ui, state);
    renderPreview(ui, state);
  }
  ui.screen.render();
}
