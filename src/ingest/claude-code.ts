/**
 * Lore - Claude Code Adapter
 *
 * Ingests Claude Code conversation JSONL files and converts to Lore SourceDocument format.
 * Claude Code stores conversations in ~/.claude/projects/<project-path>/<session-id>.jsonl
 */

import { readFile, readdir, stat } from 'fs/promises';
import path from 'path';
import type { SourceDocument, Quote, Theme, ContentType } from '../core/types.js';
import { extractInsights } from '../core/insight-extractor.js';

/**
 * Claude Code message types
 */
interface ClaudeCodeMessage {
  type: 'user' | 'assistant' | 'progress' | 'file-history-snapshot' | string;
  uuid: string;
  parentUuid: string | null;
  sessionId: string;
  timestamp: string;
  cwd?: string;
  gitBranch?: string;
  version?: string;
  isSidechain?: boolean;
  isMeta?: boolean;
  userType?: 'external' | 'internal';
  message?: {
    role: 'user' | 'assistant';
    content: string | ContentBlock[];
  };
}

interface ContentBlock {
  type: 'text' | 'thinking' | 'tool_use' | 'tool_result';
  text?: string;
  thinking?: string;
  name?: string;
  input?: unknown;
}

interface ParsedConversation {
  sessionId: string;
  projectPath: string;
  messages: Array<{
    role: 'user' | 'assistant';
    content: string;
    timestamp: string;
    uuid: string;
  }>;
  metadata: {
    version?: string;
    gitBranch?: string;
    cwd?: string;
    startTime: string;
    endTime: string;
  };
}

/**
 * Extract text content from a content block array
 */
function extractTextFromContent(content: string | ContentBlock[]): string {
  if (typeof content === 'string') {
    return content;
  }

  return content
    .filter((block) => block.type === 'text' && block.text)
    .map((block) => block.text)
    .join('\n');
}

/**
 * Check if a user message should be skipped (meta messages, commands, etc.)
 */
function shouldSkipMessage(msg: ClaudeCodeMessage): boolean {
  if (msg.isMeta) return true;
  if (msg.type !== 'user' && msg.type !== 'assistant') return true;
  if (!msg.message?.content) return true;

  const content = typeof msg.message.content === 'string'
    ? msg.message.content
    : extractTextFromContent(msg.message.content);

  // Skip command messages
  if (content.includes('<command-name>')) return true;
  if (content.includes('<local-command-')) return true;
  if (content.trim().length === 0) return true;

  return false;
}

/**
 * Parse a Claude Code JSONL file into a structured conversation
 */
export async function parseClaudeCodeConversation(
  filePath: string
): Promise<ParsedConversation | null> {
  const content = await readFile(filePath, 'utf-8');
  const lines = content.trim().split('\n').filter((line) => line.trim());

  if (lines.length === 0) return null;

  const messages: ParsedConversation['messages'] = [];
  let sessionId = '';
  let projectPath = '';
  let version: string | undefined;
  let gitBranch: string | undefined;
  let cwd: string | undefined;
  let startTime = '';
  let endTime = '';

  for (const line of lines) {
    try {
      const msg: ClaudeCodeMessage = JSON.parse(line);

      // Extract metadata from first message
      if (!sessionId && msg.sessionId) {
        sessionId = msg.sessionId;
        version = msg.version;
        gitBranch = msg.gitBranch;
        cwd = msg.cwd;
        projectPath = cwd || '';
      }

      // Track time bounds
      if (msg.timestamp) {
        if (!startTime || msg.timestamp < startTime) {
          startTime = msg.timestamp;
        }
        if (!endTime || msg.timestamp > endTime) {
          endTime = msg.timestamp;
        }
      }

      // Skip non-conversation messages
      if (shouldSkipMessage(msg)) continue;

      const textContent = typeof msg.message!.content === 'string'
        ? msg.message!.content
        : extractTextFromContent(msg.message!.content);

      if (textContent.trim()) {
        messages.push({
          role: msg.message!.role,
          content: textContent,
          timestamp: msg.timestamp,
          uuid: msg.uuid,
        });
      }
    } catch {
      // Skip malformed lines
      continue;
    }
  }

  if (messages.length === 0) return null;

  return {
    sessionId,
    projectPath,
    messages,
    metadata: {
      version,
      gitBranch,
      cwd,
      startTime,
      endTime,
    },
  };
}

/**
 * Format conversation as markdown
 */
function formatConversationAsMarkdown(parsed: ParsedConversation): string {
  const lines: string[] = [];

  lines.push(`# Claude Code Conversation`);
  lines.push('');
  lines.push(`**Session ID:** ${parsed.sessionId}`);
  if (parsed.metadata.cwd) {
    lines.push(`**Working Directory:** ${parsed.metadata.cwd}`);
  }
  if (parsed.metadata.gitBranch) {
    lines.push(`**Git Branch:** ${parsed.metadata.gitBranch}`);
  }
  lines.push(`**Started:** ${new Date(parsed.metadata.startTime).toLocaleString()}`);
  lines.push(`**Ended:** ${new Date(parsed.metadata.endTime).toLocaleString()}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  for (const msg of parsed.messages) {
    const speaker = msg.role === 'user' ? '**User:**' : '**Claude:**';
    const time = new Date(msg.timestamp).toLocaleTimeString();
    lines.push(`### ${speaker} [${time}]`);
    lines.push('');
    lines.push(msg.content);
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Generate a title from the first user message
 */
function generateTitle(messages: ParsedConversation['messages']): string {
  const firstUserMessage = messages.find((m) => m.role === 'user');
  if (!firstUserMessage) return 'Claude Code Conversation';

  // Take first sentence or first 80 characters
  const content = firstUserMessage.content.trim();
  const firstSentence = content.split(/[.!?]/)[0];
  const title = firstSentence.length > 80
    ? firstSentence.substring(0, 77) + '...'
    : firstSentence;

  return title || 'Claude Code Conversation';
}

/**
 * Ingest a single Claude Code conversation JSONL file
 */
export async function ingestClaudeCodeConversation(
  filePath: string,
  options: {
    project?: string;
    extractInsightsEnabled?: boolean;
  } = {}
): Promise<{
  source: SourceDocument;
  insights?: { summary: string; themes: Theme[]; quotes: Quote[] };
} | null> {
  const { project, extractInsightsEnabled = true } = options;

  const parsed = await parseClaudeCodeConversation(filePath);
  if (!parsed) return null;

  const title = generateTitle(parsed.messages);
  const fullContent = formatConversationAsMarkdown(parsed);

  // Create source document
  const source: SourceDocument = {
    id: parsed.sessionId,
    source_type: 'claude-code',
    source_id: parsed.sessionId,
    source_path: filePath,
    title,
    content: fullContent,
    content_type: 'conversation',
    created_at: parsed.metadata.startTime,
    imported_at: new Date().toISOString(),
    participants: ['user', 'claude'],
    projects: project ? [project] : [],
    tags: parsed.metadata.gitBranch ? [parsed.metadata.gitBranch] : [],
  };

  // Extract insights if enabled
  let insights: { summary: string; themes: Theme[]; quotes: Quote[] } | undefined;
  if (extractInsightsEnabled && parsed.messages.length > 2) {
    insights = await extractInsights(fullContent, title, parsed.sessionId, {
      contentType: 'conversation',
    });
  }

  return { source, insights };
}

/**
 * List all Claude Code conversations from the default directory
 */
export async function listClaudeCodeConversations(
  claudeDir: string = path.join(process.env.HOME || '~', '.claude', 'projects')
): Promise<Array<{
  id: string;
  title: string;
  created_at: string;
  path: string;
  projectPath: string;
}>> {
  const results: Array<{
    id: string;
    title: string;
    created_at: string;
    path: string;
    projectPath: string;
  }> = [];

  try {
    const projectDirs = await readdir(claudeDir, { withFileTypes: true });

    for (const projectDir of projectDirs) {
      if (!projectDir.isDirectory() || projectDir.name.startsWith('.')) continue;

      const projectPath = path.join(claudeDir, projectDir.name);
      const files = await readdir(projectPath, { withFileTypes: true });

      for (const file of files) {
        if (!file.name.endsWith('.jsonl')) continue;
        // Skip agent files (subagent conversations)
        if (file.name.startsWith('agent-')) continue;

        const filePath = path.join(projectPath, file.name);

        try {
          const parsed = await parseClaudeCodeConversation(filePath);
          if (parsed && parsed.messages.length > 0) {
            results.push({
              id: parsed.sessionId,
              title: generateTitle(parsed.messages),
              created_at: parsed.metadata.startTime,
              path: filePath,
              projectPath: parsed.projectPath,
            });
          }
        } catch {
          // Skip files that can't be parsed
        }
      }
    }
  } catch {
    // Directory doesn't exist
  }

  return results.sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
}

/**
 * Ingest all Claude Code conversations from a directory
 */
export async function ingestClaudeCodeConversations(
  claudeDir: string = path.join(process.env.HOME || '~', '.claude', 'projects'),
  options: {
    project?: string;
    extractInsightsEnabled?: boolean;
    onProgress?: (current: number, total: number, title: string) => void;
    skipExisting?: string[];
    limit?: number;
  } = {}
): Promise<Array<{
  source: SourceDocument;
  insights?: { summary: string; themes: Theme[]; quotes: Quote[] };
}>> {
  const { project, extractInsightsEnabled = true, onProgress, skipExisting = [], limit } = options;

  const conversations = await listClaudeCodeConversations(claudeDir);
  const toProcess = conversations
    .filter((c) => !skipExisting.includes(c.id))
    .slice(0, limit);

  const results: Array<{
    source: SourceDocument;
    insights?: { summary: string; themes: Theme[]; quotes: Quote[] };
  }> = [];

  for (let i = 0; i < toProcess.length; i++) {
    const conv = toProcess[i];
    onProgress?.(i + 1, toProcess.length, conv.title);

    try {
      const result = await ingestClaudeCodeConversation(conv.path, {
        project,
        extractInsightsEnabled,
      });

      if (result) {
        results.push(result);
      }
    } catch (error) {
      console.error(`Error ingesting ${conv.id}:`, error);
    }
  }

  return results;
}
