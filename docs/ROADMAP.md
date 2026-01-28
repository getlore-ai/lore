# Lore - Development Roadmap

## Phase 1: Foundation (Current)

### Core Infrastructure ✅
- [x] Project structure
- [x] TypeScript setup
- [x] Core types with citation model
- [x] Vector store (adapted from granola-extractor)
- [x] Embedder (adapted from granola-extractor)
- [x] MCP server skeleton
- [x] Tool definitions

### MCP Handlers ✅
- [x] `search` - Basic implementation
- [x] `get_source` - Basic implementation
- [x] `list_sources` - Basic implementation
- [x] `get_quotes` - Basic implementation
- [x] `list_projects` - Basic implementation
- [x] `retain` - Basic implementation (saves to disk)
- [x] `research` - Placeholder (multi-step search, no Agent SDK yet)

## Phase 2: Granola Integration

### Granola Adapter
- [ ] Create `src/ingest/granola.ts`
- [ ] Read granola-extractor export format
- [ ] Convert to Lore source document format
- [ ] Extract quotes with speaker attribution
- [ ] Map themes from granola-extractor
- [ ] Preserve timestamps for citations

### CLI Ingest Command
- [ ] `lore ingest <path> --type granola`
- [ ] Process all documents in export directory
- [ ] Progress reporting
- [ ] Incremental updates (skip already indexed)

### CLI Sync Command
- [ ] `lore sync` - Full reindex
- [ ] `lore sync --watch` - Watch for changes
- [ ] Generate embeddings for all sources and chunks
- [ ] Build vector index

## Phase 3: Research Agent

### Claude Agent SDK Integration
- [ ] Add `@anthropic-ai/sdk` agent capabilities
- [ ] Design research agent system prompt
- [ ] Implement multi-step search strategy
- [ ] Add source cross-referencing
- [ ] Generate synthesized summaries
- [ ] Include proper citations in output

### Research Tool Enhancement
- [ ] Replace placeholder with Agent SDK
- [ ] Add depth levels (quick/thorough/exhaustive)
- [ ] Identify knowledge gaps
- [ ] Suggest follow-up queries
- [ ] Track research provenance

## Phase 4: Additional Source Adapters

### Claude Code Adapter
- [ ] Parse Claude Code conversation exports
- [ ] Extract decisions and insights
- [ ] Handle tool calls and code blocks
- [ ] Map to source document format

### Markdown Adapter
- [ ] Ingest markdown documents
- [ ] Extract structure (headings, lists)
- [ ] Support frontmatter for metadata
- [ ] Handle links between documents

### Claude Desktop Adapter
- [ ] Research export format
- [ ] Build parser
- [ ] Handle project exports

## Phase 5: Project Management

### Project CRUD
- [ ] `lore project create <name>`
- [ ] `lore project list`
- [ ] `lore project info <name>`
- [ ] Project metadata storage

### Lineage Tracking
- [ ] Log decisions to project
- [ ] Track pivots and milestones
- [ ] Query project history
- [ ] MCP tool: `get_project_lineage`

### Context Building
- [ ] Build delegation packages
- [ ] Summarize project state
- [ ] Export for agent handoff

## Phase 6: Polish & Production

### Performance
- [ ] Batch embedding generation
- [ ] Incremental indexing
- [ ] Query caching
- [ ] Large corpus optimization

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

- **Web UI**: Browse and manage knowledge
- **API Server**: REST/GraphQL access beyond MCP
- **Collaborative**: Multi-user with permissions
- **Cloud Sync**: Optional backup/sync (like Basic Memory Cloud)
- **Plugin System**: Custom source adapters
- **LLM-Powered Extraction**: Use Claude for better theme extraction
