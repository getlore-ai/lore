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
| `ingest` | Simple | Add a document directly (meeting notes, interviews, etc.) |
| `sync` | Simple | Refresh index (git pull + index new sources) |
| `archive_project` | Simple | Archive a project (human-triggered curation) |
| `research` | Agentic | Comprehensive research with conflict-aware synthesis |

## Project Structure

```
src/
├── core/              # Shared infrastructure
│   ├── types.ts       # Full data model with Citation type
│   ├── embedder.ts    # OpenAI embeddings
│   ├── vector-store.ts # Supabase + pgvector
│   └── insight-extractor.ts # Summary generation (agent does deep analysis)
├── ingest/            # Source adapters
│   ├── granola.ts     # Granola meeting exports
│   ├── claude-code.ts # Claude Code conversations
│   └── markdown.ts    # Any markdown documents
├── mcp/
│   ├── server.ts      # MCP server entry
│   ├── tools.ts       # Tool definitions (Zod schemas)
│   └── handlers/      # 7 handler implementations
└── index.ts           # CLI with ingest, sync, search commands
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
OPENAI_API_KEY=...              # Required for embeddings
ANTHROPIC_API_KEY=...           # Required for research agent
SUPABASE_URL=...                # Supabase project URL
SUPABASE_ANON_KEY=...           # Supabase anon/service key
LORE_DATA_DIR=~/lore-data       # Data directory for raw documents (git-synced)
LORE_AUTO_GIT_PULL=true         # Auto git pull every 5 min (default: true)
LORE_AUTO_INDEX=true            # Auto-index new sources (default: true, costs API calls)
```

## Code vs Data Separation

**Lore (this repo)** = reusable tool, shareable
**Data directory** = your personal knowledge, separate location
**Supabase** = cloud vector index, shared across all machines

The `LORE_DATA_DIR` should point to a separate directory (its own git repo for cross-machine sync of raw documents). Vector embeddings are stored in Supabase for multi-agent, multi-machine access.

```
~/lore-data/              # Your data repo (separate git repo)
├── sources/              # Ingested documents (git-tracked)
├── retained/             # Explicitly saved insights (git-tracked)
└── archived-projects.json

Supabase (cloud):         # Vector index - shared across all machines
├── sources table         # Document metadata + embeddings
└── chunks table          # Quotes/chunks + embeddings
```

## Implementation Status

All core features are implemented:

- **Ingestion Adapters**: Granola, Claude Code, Markdown
- **CLI Commands**: `ingest`, `sync`, `search`, `projects`, `mcp`
- **MCP Tools**: All 7 tools fully functional
- **LLM-powered Research**: Uses GPT-4o-mini for synthesis
- **Instant Indexing**: Retained items immediately searchable

## Usage

```bash
# Ingest Granola meeting exports
lore ingest ~/exports/granola --type granola -p myproject

# Ingest Claude Code conversations
lore ingest ~/.claude/projects --type claude-code -p myproject

# Ingest any markdown documents (competitor analyses, ChatGPT dumps, specs, etc.)
lore ingest ~/docs --type markdown -p myproject

# Search
lore search "user pain points"

# Start MCP server
lore mcp
```

## Design Philosophy: Agentic Extraction

**What we store at ingest time:**
- Raw content (complete, lossless)
- Summary (for quick context)
- Embeddings (for retrieval)

**What we DON'T do:**
- Pre-categorize into themes
- Force content into predefined buckets
- Extract quotes/insights at ingest time

**Why:** The agent reasons at query time with full context. This is more accurate than pre-categorizing because:
- No mis-categorization
- Extracts what's relevant to YOUR query, not generic categories
- Adapts to new types of questions without code changes

## Agentic Research (Claude Agent SDK)

The `research` tool uses the **Claude Agent SDK** for truly iterative research:

```
research("What authentication approach should we use?")
    │
    ├─→ search("authentication user feedback")
    │      └─→ Found 3 interviews mentioning auth
    │
    ├─→ get_source(interview_1)
    │      └─→ "Sarah said OAuth was confusing"
    │
    ├─→ search("authentication decisions")
    │      └─→ Found decision to use JWT
    │
    ├─→ get_quotes(theme: "requirements")
    │      └─→ Found 5 specific requirements
    │
    └─→ Synthesize everything into ResearchPackage
```

**How it works:**
1. Claude Agent gets access to Lore's own tools (search, get_source, get_quotes, list_sources)
2. Agent iteratively explores, following leads
3. Cross-references findings across sources
4. Synthesizes with citations

**Configuration:**
- Default: Agentic mode (Claude Agent SDK) - agent self-terminates when it has enough evidence
- Fallback: `LORE_RESEARCH_MODE=simple` for single-pass GPT-4o-mini synthesis

## Key Design Decisions

1. **Hybrid MCP approach**: Simple tools for direct queries + agentic tool for complex research
2. **Push-based for noisy sources**: Claude Code uses `retain` tool, Granola is fully ingested
3. **Citations are first-class**: Every Quote has a Citation linking to source
4. **Projects organize knowledge**: All sources associate with projects
5. **Lineage tracks history**: Decisions, pivots, milestones logged per project

## Knowledge Evolution & Conflicts

Lore handles outdated/conflicting information through **smart synthesis, not automatic curation**:

1. **Time-weighted ranking**: Recent sources naturally rank higher in search results
2. **Conflict-aware synthesis**: Research agent detects contradictions and prefers newer sources
3. **Transparent resolution**: When conflicts exist, the response includes `conflicts_resolved` showing the evolution (e.g., "Earlier approach was X (Jan 5), changed to Y (Jan 15). Current: Y")
4. **Human-triggered archiving**: Use `archive_project` to archive entire projects when they're completed/superseded
5. **Nothing auto-deleted**: All sources preserved for historical context, just filtered from default search

This approach ensures:
- Consumers get current understanding without confusion
- Historical context remains accessible (`include_archived: true`)
- No silent data loss from AI reasoning errors
- Transparent, traceable reasoning

## Non-Goals

- Not a ChatGPT integration (moving away from ChatGPT)
- Not a note-taking app (sources come from other tools)
- Not multi-user (single-user focus initially)
