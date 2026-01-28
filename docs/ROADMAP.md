# Lore - Development Roadmap

## Phase 1: Foundation ✅

### Core Infrastructure
- [x] Project structure
- [x] TypeScript setup
- [x] Core types with citation model
- [x] Vector store (LanceDB)
- [x] Embedder (OpenAI)
- [x] MCP server
- [x] Tool definitions (Zod schemas)

### MCP Handlers
- [x] `search` - Semantic search with filters
- [x] `get_source` - Full source retrieval
- [x] `list_sources` - Browse by project/type
- [x] `get_quotes` - Find citable quotes by theme
- [x] `list_projects` - Project overview with stats
- [x] `retain` - Save insights/decisions (instant indexing)

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
- [x] `lore sync` - Rebuild index + git pull/push
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

### Claude Code Adapter
- [x] Parse Claude Code conversation exports
- [x] Extract decisions and insights
- [x] Handle tool calls and code blocks
- [x] Map to source document format

### Markdown Adapter
- [x] Ingest any markdown documents
- [x] Extract structure (headings, lists)
- [x] Support frontmatter for metadata
- [x] Useful for competitor analyses, ChatGPT exports, specs, etc.

### Claude Desktop Adapter
- [ ] Research export format (not yet available/documented)
- [ ] Build parser
- [ ] Handle project exports

## Phase 5: Project Management ✅

- [x] `list_projects` - Overview with source counts
- [x] `archive_project` - Archive with reason and successor
- [x] Lineage reconstruction via `research` agent (no explicit tracking needed)
- [x] Context building via `research` agent (produces ResearchPackage with citations)

## Phase 6: Polish & Production

### Performance
- [ ] Batch embedding generation
- [ ] Query caching
- [ ] Large corpus optimization (1000+ sources)

### Developer Experience
- [ ] Better error messages
- [ ] Logging with levels
- [ ] Debug mode for MCP
- [ ] Documentation site

### Testing
- [ ] Unit tests for core
- [ ] Integration tests for MCP
- [ ] Test fixtures with sample data

## Future Ideas

- **Web UI**: Browse and manage knowledge visually
- **API Server**: REST/GraphQL access beyond MCP
- **Collaborative**: Multi-user with permissions
- **Cloud Sync**: Optional backup/sync
- **Plugin System**: Custom source adapters
- **Real-time Ingestion**: Watch folders for new sources
