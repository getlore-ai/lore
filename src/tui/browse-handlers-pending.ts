/**
 * Pending proposal handlers for the Lore Document Browser TUI
 *
 * Handles viewing, approving, and rejecting extension proposals.
 */

import type { BrowserState, UIComponents } from './browse-types.js';
import { renderPendingList, renderPendingPreview, updateStatus } from './browse-render.js';
import { listPendingProposals, approveProposal, rejectProposal } from '../extensions/proposals.js';

/**
 * Show the pending proposals view
 */
export async function showPendingView(
  state: BrowserState,
  ui: UIComponents,
  dbPath: string,
  dataDir: string
): Promise<void> {
  ui.statusBar.setContent(' Loading pending proposals...');
  ui.screen.render();

  state.pendingList = await listPendingProposals();
  state.selectedPendingIndex = 0;
  state.mode = 'pending';
  state.pendingConfirmAction = null;

  ui.listTitle.setContent(' Pending');
  ui.previewTitle.setContent(' Proposal');
  ui.footer.setContent(' ↑↓ Navigate  │  a Approve  │  r Reject  │  Esc Back');

  renderPendingList(ui, state);
  renderPendingPreview(ui, state);
  updateStatus(ui, state);
  ui.screen.render();
}

/**
 * Refresh the pending proposals list
 */
export async function refreshPendingView(
  state: BrowserState,
  ui: UIComponents
): Promise<void> {
  state.pendingList = await listPendingProposals();
  if (state.selectedPendingIndex >= state.pendingList.length) {
    state.selectedPendingIndex = Math.max(0, state.pendingList.length - 1);
  }
  renderPendingList(ui, state);
  renderPendingPreview(ui, state);
  updateStatus(ui, state);
  ui.screen.render();
}

/**
 * Show confirmation dialog for pending action
 */
function confirmPendingAction(
  state: BrowserState,
  ui: UIComponents,
  prompt: string,
  onConfirm: () => Promise<void>
): void {
  state.pendingConfirmAction = prompt.includes('Reject') ? 'reject' : 'approve';
  ui.statusBar.setContent(` ${prompt} (y/n)`);
  ui.screen.render();

  const handler = async (_ch: string | undefined, key: { name?: string }) => {
    if (!key?.name) return;
    if (key.name === 'y') {
      ui.screen.removeListener('keypress', handler);
      state.pendingConfirmAction = null;
      await onConfirm();
      return;
    }
    if (key.name === 'n' || key.name === 'escape') {
      ui.screen.removeListener('keypress', handler);
      state.pendingConfirmAction = null;
      updateStatus(ui, state);
      renderPendingPreview(ui, state);
      ui.screen.render();
    }
  };

  ui.screen.on('keypress', handler);
}

/**
 * Approve the currently selected proposal
 */
export function approveSelectedProposal(
  state: BrowserState,
  ui: UIComponents,
  dbPath: string,
  dataDir: string
): void {
  const proposal = state.pendingList[state.selectedPendingIndex];
  if (!proposal || proposal.status !== 'pending') return;

  confirmPendingAction(state, ui, 'Approve proposal', async () => {
    await approveProposal(proposal.id, dbPath, dataDir);
    await refreshPendingView(state, ui);
    ui.statusBar.setContent(` {green-fg}Approved ${proposal.id}{/green-fg}`);
    ui.screen.render();
    setTimeout(() => {
      updateStatus(ui, state);
      ui.screen.render();
    }, 1200);
  });
}

/**
 * Reject the currently selected proposal
 */
export function rejectSelectedProposal(
  state: BrowserState,
  ui: UIComponents
): void {
  const proposal = state.pendingList[state.selectedPendingIndex];
  if (!proposal || proposal.status !== 'pending') return;

  confirmPendingAction(state, ui, 'Reject proposal', async () => {
    await rejectProposal(proposal.id, 'Rejected in TUI');
    await refreshPendingView(state, ui);
    ui.statusBar.setContent(` {yellow-fg}Rejected ${proposal.id}{/yellow-fg}`);
    ui.screen.render();
    setTimeout(() => {
      updateStatus(ui, state);
      ui.screen.render();
    }, 1200);
  });
}
