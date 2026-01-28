# Lore - Claude Code Context

> "The lore behind your projects"

## Quick Context

Lore is a **research knowledge repository** for rapid prototyping and user research. It's NOT a memory system - it preserves original sources with citations.

**Key difference from memory systems:**
- Memory: "Users want faster exports" (no source)
- Lore: "In the Jan 15 interview at 12:34, Sarah said 'The export takes forever'" (citable)

## Documentation

Detailed docs are in the `docs/` folder:
- **[VISION.md](docs/VISION.md)** - Full requirements and architecture decisions
- **[ROADMAP.md](docs/ROADMAP.md)** - Development phases and tasks
- **[DATA_MODEL.md](docs/DATA_MODEL.md)** - Complete type system and storage schema
- **[GRANOLA_INTEGRATION.md](docs/GRANOLA_INTEGRATION.md)** - Relationship with granola-extractor

## Core Use Case

```
You: "Build a solution that addresses the feedback I received this week"

Lore enables:
1. Search user interviews from Granola with citations
2. Find related decisions and their rationale
3. Retrieve evidence with exact quotes and sources
4. Package context for agent delegation
```

## Architecture: Three Layers

```
SOURCE DOCUMENTS (immutable originals)
    ↓
EXTRACTED INSIGHTS (quotes, themes, decisions - with citations back to sources)
    ↓
WORKING CONTEXT (research packages, project summaries for agents)
```

## MCP Tools

| Tool | Type | Purpose |
|------|------|---------|
| `search` | Simple | Semantic search, returns summaries + quotes |
| `get_source` | Simple | Full source with original content |
| `list_sources` | Simple | Browse by project/type |
| `get_quotes` | Simple | Find citable quotes by theme |
| `list_projects` | Simple | Project overview |
| `retain` | Simple | Explicitly save insights (push-based) |
| `research` | Agentic | Comprehensive research with Claude Agent SDK |

## Project Structure

```
src/
├── core/              # Shared infrastructure
│   ├── types.ts       # Full data model with Citation type
│   ├── embedder.ts    # OpenAI embeddings (from granola-extractor)
│   └── vector-store.ts # LanceDB wrapper (adapted)
├── ingest/            # Source adapters (TODO)
├── projects/          # Project management (TODO)
├── mcp/
│   ├── server.ts      # MCP server entry
│   ├── tools.ts       # Tool definitions
│   └── handlers/      # 7 handler implementations
└── agents/            # Claude Agent SDK (TODO)
```

## Relationship to granola-extractor

Located at `~/workspace/granola-extractor`:
- Extracts meeting notes from Granola app
- Has its own MCP server (will be superseded by Lore)
- Code was adapted for Lore's core infrastructure

**Integration plan:**
1. Lore ingests granola-extractor's exports
2. Eventually, Granola adapter moves into Lore
3. granola-extractor becomes deprecated

## Development

```bash
npm install           # Install dependencies
npm run build         # Compile TypeScript
npm run dev           # Run with tsx
npm run mcp           # Start MCP server

# Environment
OPENAI_API_KEY=...    # Required for embeddings
ANTHROPIC_API_KEY=... # Required for research agent
LORE_DATA_DIR=./data  # Data directory
```

## Priority Tasks

1. **Granola Adapter** - `src/ingest/granola.ts`
   - Read granola-extractor export format
   - Convert to Lore SourceDocument
   - Preserve speaker attribution and timestamps

2. **Sync Command** - `lore sync`
   - Full reindexing of all sources
   - Generate embeddings
   - Progress reporting

3. **Research Agent** - `src/mcp/handlers/research.ts`
   - Replace placeholder with Claude Agent SDK
   - Multi-step search and synthesis
   - Proper citations in output

4. **Retain to Vector Store** - `src/mcp/handlers/retain.ts`
   - Currently saves to disk only
   - Add immediate vector store insertion

## Key Design Decisions

1. **Hybrid MCP approach**: Simple tools for direct queries + agentic tool for complex research
2. **Push-based for noisy sources**: Claude Code uses `retain` tool, Granola is fully ingested
3. **Citations are first-class**: Every Quote has a Citation linking to source
4. **Projects organize knowledge**: All sources associate with projects
5. **Lineage tracks history**: Decisions, pivots, milestones logged per project

## Non-Goals

- Not a ChatGPT integration (moving away from ChatGPT)
- Not a note-taking app (sources come from other tools)
- Not multi-user (single-user focus initially)
