/**
 * Types and interfaces for the Lore Document Browser TUI
 */

import type { SourceType, ContentType, Theme, Quote, SearchMode } from '../core/types.js';

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

export type Mode = 'list' | 'search' | 'regex-search' | 'fullview' | 'doc-search' | 'help';

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
  fullViewContent: any;
  helpPane: any;
  searchInput: any;
  regexInput: any;
  docSearchInput: any;
  footer: any;
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
