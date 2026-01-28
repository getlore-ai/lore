# Lore - Development Roadmap

## Phase 1: Foundation ✅

### Core Infrastructure
- [x] Project structure
- [x] TypeScript setup
- [x] Core types with citation model
- [x] Vector store (Supabase + pgvector)
- [x] Embedder (OpenAI)
- [x] MCP server
- [x] Tool definitions (Zod schemas)

### MCP Handlers
- [x] `search` - Semantic search with filters
- [x] `get_source` - Full source retrieval (includes quotes)
- [x] `list_sources` - Browse by project/type
- [x] `list_projects` - Project overview with stats
- [x] `retain` - Save insights/decisions (instant indexing)
- [x] `ingest` - Add documents directly via MCP
- [x] `sync` - Two-phase sync with content hash deduplication
- [x] `archive_project` - Archive completed/superseded projects
- [x] `research` - Agentic research with Claude Agent SDK

## Phase 2: Granola Integration ✅

### Granola Adapter
- [x] `src/ingest/granola.ts`
- [x] Read granola-extractor export format
- [x] Convert to Lore source document format
- [x] Extract quotes with speaker attribution
- [x] Map themes from granola-extractor
- [x] Preserve timestamps for citations

### CLI Commands
- [x] `lore ingest <path> --type granola`
- [x] Process all documents in export directory
- [x] Progress reporting
- [x] `lore sync` - Two-phase sync with git integration
- [x] Auto-sync on interval (configurable)

## Phase 3: Research Agent ✅

### Claude Agent SDK Integration
- [x] Add `@anthropic-ai/claude-agent-sdk`
- [x] Design research agent system prompt
- [x] Implement multi-step search strategy
- [x] Source cross-referencing
- [x] Synthesized summaries with citations
- [x] Conflict detection and resolution (prefers newer sources)

### Research Tool
- [x] Full agentic research via Claude Agent SDK
- [x] Fallback to simple mode (`LORE_RESEARCH_MODE=simple`)
- [x] Agent self-determines when to stop (no forced depth levels)
- [x] Identify knowledge gaps
- [x] Suggest follow-up queries
- [x] 50-turn safety limit

## Phase 4: Source Adapters ✅

### Claude Code Adapter (Legacy)
- [x] Parse Claude Code conversation exports
- [x] Extract decisions and insights
- [x] Handle tool calls and code blocks
- [x] Map to source document format

### Markdown Adapter (Legacy)
- [x] Ingest any markdown documents
- [x] Extract structure (headings, lists)
- [x] Support frontmatter for metadata
- [x] Useful for competitor analyses, ChatGPT exports, specs, etc.

### Universal Sync (Replaces Legacy Adapters) ✅
- [x] Two-phase sync architecture
- [x] Phase 1: Discovery (no LLM calls, free)
  - [x] Scan configured source directories
  - [x] Compute SHA256 content hashes
  - [x] Check Supabase for existing hashes
- [x] Phase 2: Processing (only new files)
  - [x] Claude extracts metadata (title, summary, date, participants, content_type)
  - [x] Generate embeddings via OpenAI
  - [x] Store with content_hash for cross-machine deduplication
- [x] Format preprocessors (Markdown, JSONL, JSON)
- [x] Machine-specific config (`~/.config/lore/sync-sources.json`)
- [x] CLI: `lore sources list/add/enable/disable/remove`

## Phase 5: Project Management ✅

- [x] `list_projects` - Overview with source counts
- [x] `archive_project` - Archive with reason and successor
- [x] Lineage reconstruction via `research` agent (no explicit tracking needed)
- [x] Context building via `research` agent (produces ResearchPackage with citations)

## Phase 6: Multi-Machine Support ✅

- [x] Supabase for cloud vector storage (shared across machines)
- [x] Git for raw document sync
- [x] Content hash deduplication (same content = same hash, regardless of path/machine)
- [x] Machine-specific sync source configuration
- [x] Database migration for `content_hash` and `source_path` columns

## Phase 7: Polish & Production

### Performance
- [ ] Query caching
- [ ] Large corpus optimization (1000+ sources)

### Developer Experience
- [ ] Better error messages
- [ ] Logging with levels
- [ ] Debug mode for MCP

### Documentation
- [ ] Documentation site
- [ ] API reference
- [ ] Tutorial/getting started guide

### Testing
- [ ] Unit tests for core
- [ ] Integration tests for MCP
- [ ] Test fixtures with sample data

## Future Ideas

- **Web UI**: Browse and manage knowledge visually
- **API Server**: REST/GraphQL access beyond MCP
- **Collaborative**: Multi-user with permissions
- **Plugin System**: Custom source adapters
- **Real-time Watch**: Auto-sync when files change in watched directories
