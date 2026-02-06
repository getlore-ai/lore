/**
 * Pending proposals CLI commands
 *
 * lore pending list|show|approve|reject
 */

import type { Command } from 'commander';
import path from 'path';

import {
  listPendingProposals,
  getProposal,
  approveProposal,
  rejectProposal,
} from '../../extensions/proposals.js';

function formatProposalSummary(entry: {
  id: string;
  extensionName: string;
  createdAt: string;
  status: string;
  change: { type: string; reason: string };
}): string {
  const date = new Date(entry.createdAt).toLocaleString();
  return `${entry.id}  ${entry.status}  ${entry.extensionName}  ${entry.change.type}  ${date}`;
}

export function registerPendingCommand(extensionCmd: Command, defaultDataDir: string): void {
  const pending = extensionCmd
    .command('pending')
    .description('Review and approve extension write proposals');

  pending
    .command('list')
    .description('List pending proposals')
    .action(async () => {
      const proposals = await listPendingProposals();
      if (proposals.length === 0) {
        console.log('No pending proposals.');
        return;
      }
      console.log('ID  Status  Extension  Type  Created');
      console.log('──────────────────────────────────────────────');
      for (const proposal of proposals) {
        console.log(formatProposalSummary(proposal));
      }
    });

  pending
    .command('show')
    .description('Show proposal details')
    .argument('<id>', 'Proposal ID')
    .action(async (id) => {
      const proposal = await getProposal(id);
      if (!proposal) {
        console.error(`Proposal not found: ${id}`);
        process.exit(1);
      }
      console.log(JSON.stringify(proposal, null, 2));
    });

  pending
    .command('approve')
    .description('Approve and apply a proposal')
    .argument('<id>', 'Proposal ID')
    .option('-d, --data-dir <dir>', 'Data directory', defaultDataDir)
    .action(async (id, options) => {
      const dataDir = options.dataDir;
      const dbPath = path.join(dataDir, 'lore.lance');
      await approveProposal(id, dbPath, dataDir);
      console.log(`Approved proposal ${id}`);
    });

  pending
    .command('reject')
    .description('Reject a proposal')
    .argument('<id>', 'Proposal ID')
    .option('-r, --reason <reason>', 'Rejection reason', 'Rejected by user')
    .action(async (id, options) => {
      await rejectProposal(id, options.reason);
      console.log(`Rejected proposal ${id}`);
    });
}
