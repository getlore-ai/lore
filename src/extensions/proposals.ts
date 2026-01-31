/**
 * Proposal-based write system for extensions
 */

import { randomUUID } from 'crypto';
import { existsSync } from 'fs';
import { mkdir, readFile, readdir, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';

import { handleIngest } from '../mcp/handlers/ingest.js';
import { handleRetain } from '../mcp/handlers/retain.js';
import { getDatabase, getSourceById } from '../core/vector-store.js';

export interface ProposedChange {
  type: 'create_source' | 'update_source' | 'delete_source' | 'retain_insight' | 'add_tags';
  // For create_source:
  title?: string;
  content?: string;
  project?: string;
  // For update_source / delete_source:
  sourceId?: string;
  changes?: Record<string, unknown>;
  // For retain_insight:
  insight?: string;
  // For add_tags:
  tags?: string[];
  // Common:
  reason: string;
}

export interface PendingProposal {
  id: string;
  extensionName: string;
  change: ProposedChange;
  createdAt: string;
  status: 'pending' | 'approved' | 'rejected';
  reviewedAt?: string;
  rejectionReason?: string;
}

export function getPendingDir(): string {
  return path.join(os.homedir(), '.config', 'lore', 'pending');
}

export async function ensurePendingDir(): Promise<void> {
  await mkdir(getPendingDir(), { recursive: true });
}

function proposalPath(id: string): string {
  return path.join(getPendingDir(), `${id}.json`);
}

async function writeProposal(proposal: PendingProposal): Promise<void> {
  await ensurePendingDir();
  await writeFile(proposalPath(proposal.id), JSON.stringify(proposal, null, 2));
}

export async function createProposal(
  extensionName: string,
  change: ProposedChange
): Promise<PendingProposal> {
  const proposal: PendingProposal = {
    id: randomUUID(),
    extensionName,
    change,
    createdAt: new Date().toISOString(),
    status: 'pending',
  };

  await writeProposal(proposal);
  return proposal;
}

export async function listPendingProposals(): Promise<PendingProposal[]> {
  const dir = getPendingDir();
  if (!existsSync(dir)) {
    return [];
  }

  const entries = await readdir(dir);
  const proposals: PendingProposal[] = [];

  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    try {
      const content = await readFile(path.join(dir, entry), 'utf-8');
      const parsed = JSON.parse(content) as PendingProposal;
      if (parsed?.id) {
        proposals.push(parsed);
      }
    } catch {
      // Skip unreadable proposals
    }
  }

  proposals.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return proposals;
}

export async function getProposal(id: string): Promise<PendingProposal | null> {
  const filePath = proposalPath(id);
  if (!existsSync(filePath)) {
    return null;
  }
  try {
    const content = await readFile(filePath, 'utf-8');
    return JSON.parse(content) as PendingProposal;
  } catch {
    return null;
  }
}

async function applyProposalChange(
  proposal: PendingProposal,
  dbPath: string,
  dataDir: string
): Promise<void> {
  const change = proposal.change;

  switch (change.type) {
    case 'create_source': {
      if (!change.title || !change.content || !change.project) {
        throw new Error('create_source requires title, content, and project');
      }
      await handleIngest(dbPath, dataDir, {
        title: change.title,
        content: change.content,
        project: change.project,
      }, { hookContext: { mode: 'cli' } });
      return;
    }
    case 'retain_insight': {
      if (!change.insight) {
        throw new Error('retain_insight requires insight');
      }
      const project = change.project || proposal.extensionName;
      await handleRetain(dbPath, dataDir, {
        content: change.insight,
        project,
        type: 'insight',
      }, {});
      return;
    }
    case 'update_source': {
      if (!change.sourceId || !change.changes) {
        throw new Error('update_source requires sourceId and changes');
      }
      const client = await getDatabase(dbPath);
      const { error } = await client
        .from('sources')
        .update(change.changes)
        .eq('id', change.sourceId);
      if (error) {
        throw error;
      }
      return;
    }
    case 'add_tags': {
      if (!change.sourceId || !change.tags) {
        throw new Error('add_tags requires sourceId and tags');
      }
      const source = await getSourceById(dbPath, change.sourceId);
      if (!source) {
        throw new Error(`Source not found: ${change.sourceId}`);
      }
      const existing = Array.isArray(source.tags) ? source.tags : [];
      const merged = Array.from(new Set([...existing, ...change.tags]));
      const client = await getDatabase(dbPath);
      const { error } = await client
        .from('sources')
        .update({ tags: merged })
        .eq('id', change.sourceId);
      if (error) {
        throw error;
      }
      return;
    }
    case 'delete_source': {
      if (!change.sourceId) {
        throw new Error('delete_source requires sourceId');
      }
      const client = await getDatabase(dbPath);
      const { error } = await client
        .from('sources')
        .delete()
        .eq('id', change.sourceId);
      if (error) {
        throw error;
      }
      return;
    }
    default: {
      const exhaustive: never = change.type;
      throw new Error(`Unknown proposal type: ${exhaustive}`);
    }
  }
}

export async function approveProposal(
  id: string,
  dbPath: string,
  dataDir: string
): Promise<void> {
  const proposal = await getProposal(id);
  if (!proposal) {
    throw new Error(`Proposal not found: ${id}`);
  }
  if (proposal.status !== 'pending') {
    throw new Error(`Proposal ${id} is already ${proposal.status}`);
  }

  await applyProposalChange(proposal, dbPath, dataDir);

  proposal.status = 'approved';
  proposal.reviewedAt = new Date().toISOString();
  await writeProposal(proposal);
}

export async function rejectProposal(id: string, reason: string): Promise<void> {
  const proposal = await getProposal(id);
  if (!proposal) {
    throw new Error(`Proposal not found: ${id}`);
  }
  if (proposal.status !== 'pending') {
    throw new Error(`Proposal ${id} is already ${proposal.status}`);
  }

  proposal.status = 'rejected';
  proposal.reviewedAt = new Date().toISOString();
  proposal.rejectionReason = reason;
  await writeProposal(proposal);
}
