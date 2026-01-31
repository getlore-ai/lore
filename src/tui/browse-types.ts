/**
 * Types and interfaces for the Lore Document Browser TUI
 */

import type { SourceType, ContentType, Theme, Quote, SearchMode } from '../core/types.js';
import type { ToolDefinition } from '../extensions/types.js';
import type { PendingProposal } from '../extensions/proposals.js';

// Source from database
export interface SourceItem {
  id: string;
  title: string;
  source_type: SourceType;
  content_type: ContentType;
  projects: string[];
  created_at: string;
  summary: string;
  score?: number;  // Similarity score from semantic search
}

// Extended source with full details
export interface SourceDetails extends SourceItem {
  tags: string[];
  themes: Theme[];
  quotes: Quote[];
}

export interface BrowseOptions {
  project?: string;
  sourceType?: SourceType;
  limit?: number;
  dataDir: string;
}

export type Mode =
  | 'list'
  | 'search'
  | 'regex-search'
  | 'fullview'
  | 'doc-search'
  | 'help'
  | 'project-picker'
  | 'tools'
  | 'pending'
  | 'ask';

export interface ToolResult {
  toolName: string;
  ok: boolean;
  result: unknown;
}

export interface ToolFormField {
  name: string;
  type: 'string' | 'number' | 'boolean';
  description: string;
  default?: unknown;
  required?: boolean;
  value: string | number | boolean | undefined;
}

// Project info for picker
export interface ProjectInfo {
  name: string;
  count: number;
  latestActivity: string;
}

// Browser state
export interface BrowserState {
  sources: SourceItem[];
  filtered: SourceItem[];
  selectedIndex: number;
  mode: Mode;
  searchQuery: string;
  searchMode: SearchMode;
  scrollOffset: number;
  fullContent: string;
  fullContentLines: string[];
  fullContentLinesRaw: string[]; // Unformatted lines for search
  gPressed: boolean; // For 'gg' command
  // Document search state
  docSearchPattern: string;
  docSearchMatches: number[]; // Line numbers with matches
  docSearchCurrentIdx: number;
  // Project picker state
  projects: ProjectInfo[];
  projectPickerIndex: number;
  currentProject?: string; // Active project filter (can change at runtime)
  toolsList: ToolDefinition[];
  selectedToolIndex: number;
  toolResult: ToolResult | null;
  toolRunning: boolean;
  toolStartTime: number | null;
  toolFormFields: ToolFormField[];
  toolFormIndex: number;
  pendingList: PendingProposal[];
  selectedPendingIndex: number;
  pendingConfirmAction: 'approve' | 'reject' | null;
  // Ask mode
  askQuery: string;
  askResponse: string;
  askStreaming: boolean;
}

// UI components from blessed
export interface UIComponents {
  screen: any;
  header: any;
  statusBar: any;
  listPane: any;
  listTitle: any;
  listContent: any;
  previewPane: any;
  previewTitle: any;
  previewContent: any;
  fullViewPane: any;
  fullViewTitle: any;
  fullViewContent: any;
  helpPane: any;
  searchInput: any;
  regexInput: any;
  docSearchInput: any;
  toolForm: any;
  toolFormContent: any;
  askInput: any;
  askPane: any;
  footer: any;
  projectPicker: any;
  projectPickerContent: any;
}

/**
 * Emoji to ASCII replacements for common emojis
 */
export const emojiReplacements: Record<string, string> = {
  // Speaker/conversation indicators (most common in transcripts)
  '💻': '[user]',    // Computer - often represents user in transcripts
  '🎤': '[speaker]', // Microphone - speaker indicator
  '💬': '[>]',
  '🎙️': '[mic]',
  '🎙': '[mic]',
  '🗣️': '[>]',
  '🗣': '[>]',
  '👤': '[*]',
  '👥': '[**]',
  '🧑': '[*]',
  '👨': '[*]',
  '👩': '[*]',
  '🦊': '[fox]',
  // Common status/action emojis
  '✅': '[ok]',
  '✓': '[ok]',
  '❌': '[x]',
  '⚠️': '[!]',
  '⚠': '[!]',
  '❗': '[!]',
  '❓': '[?]',
  '💡': '[idea]',
  '📝': '[note]',
  '📌': '[pin]',
  '🔗': '[link]',
  '📎': '[clip]',
  '📁': '[dir]',
  '📄': '[doc]',
  '📊': '[chart]',
  '📈': '[up]',
  '📉': '[down]',
  '🎯': '[target]',
  '🚀': '[launch]',
  '⭐': '[*]',
  '🌟': '[*]',
  '💪': '[+]',
  '👍': '[+1]',
  '👎': '[-1]',
  '🔥': '[!]',
  '💰': '[$]',
  '🕐': '[time]',
  '🕑': '[time]',
  '🕒': '[time]',
  '⏰': '[time]',
  '📅': '[date]',
  '🔒': '[lock]',
  '🔓': '[unlock]',
  '➡️': '->',
  '➡': '->',
  '⬅️': '<-',
  '⬅': '<-',
  '⬆️': '^',
  '⬇️': 'v',
  '▶️': '>',
  '◀️': '<',
  '🔴': '[o]',
  '🟢': '[o]',
  '🟡': '[o]',
  '🔵': '[o]',
  '🟠': '[o]',
  '🟣': '[o]',
};
