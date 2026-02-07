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
- **[PLANNED_FEATURES.md](docs/PLANNED_FEATURES.md)** - Future features and product roadmap
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
| `search` | Simple | Semantic search, returns summaries with relevance scores |
| `get_source` | Simple | Full source with original content |
| `list_sources` | Simple | Browse by project/type |
| `list_projects` | Simple | Project overview |
| `ingest` | Simple | Add content — documents, insights, decisions |
| `sync` | Simple | Refresh index (git pull + index new sources) |
| `archive_project` | Simple | Archive a project (human-triggered curation) |
| `research` | Agentic | Start async research job, returns job_id for polling |
| `research_status` | Simple | Poll for research results (long-polls up to 20s) |

## Project Structure

```
src/
├── core/              # Shared infrastructure
│   ├── types.ts       # Full data model with Citation type
│   ├── config.ts      # Centralized config (~/.config/lore/config.json)
│   ├── auth.ts        # Supabase Auth session management (OTP login)
│   ├── embedder.ts    # OpenAI embeddings
│   ├── vector-store.ts # Supabase + pgvector (auth-aware, RLS-compatible)
│   └── insight-extractor.ts # Summary generation
├── sync/              # Universal sync system
│   ├── config.ts      # Sync source configuration (~/.config/lore/sync-sources.json)
│   ├── discover.ts    # Phase 1: File discovery + hash deduplication
│   ├── processors.ts  # Format preprocessors (JSONL, JSON, etc.)
│   └── process.ts     # Phase 2: Claude metadata extraction
├── cli/commands/      # CLI command modules
│   ├── auth.ts        # login, logout, whoami, setup commands
│   ├── sync.ts        # Sync/daemon/watch/sources commands
│   ├── search.ts      # Search command
│   └── ...            # docs, projects, ask, etc.
├── ingest/            # Legacy source adapters (deprecated, use sync)
│   ├── granola.ts     # Granola meeting exports
│   ├── claude-code.ts # Claude Code conversations
│   └── markdown.ts    # Any markdown documents
├── mcp/
│   ├── server.ts      # MCP server entry (with config bridging)
│   ├── tools.ts       # Tool definitions (Zod schemas)
│   └── handlers/      # Handler implementations
└── index.ts           # CLI entry (config bridging + command registration)
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

# Environment variables (can also be set via `lore setup` → config.json)
OPENAI_API_KEY=...              # Required for embeddings
ANTHROPIC_API_KEY=...           # Required for research agent
SUPABASE_URL=...                # Supabase project URL
SUPABASE_PUBLISHABLE_KEY=...    # Supabase publishable key (has defaults, usually not needed)
SUPABASE_SERVICE_KEY=...        # Service key (bypasses RLS, env-only, never stored)
LORE_DATA_DIR=~/lore-data       # Data directory for raw documents (git-synced)
LORE_AUTO_GIT_PULL=true         # Auto git pull every 5 min (default: true)
LORE_AUTO_INDEX=true            # Auto-index new sources (default: true, costs API calls)
```

### Configuration Resolution

Keys can be provided via env vars OR `~/.config/lore/config.json` (created by `lore setup`).
Resolution order: `process.env` > `config.json` > error.
Service key (`SUPABASE_SERVICE_KEY`) is env-only and never stored in config.

## Code vs Data Separation

**Lore (this repo)** = reusable tool, shareable
**Data directory** = your personal knowledge, separate location
**Supabase** = cloud vector index, shared across all machines
**Config directory** = `~/.config/lore/` (machine-specific, not in any repo)

The `LORE_DATA_DIR` should point to a separate directory (its own git repo for cross-machine sync of raw documents). Vector embeddings are stored in Supabase for multi-agent, multi-machine access.

```
~/.config/lore/           # Machine-specific config (NOT in any repo)
├── config.json           # API keys, Supabase URL (created by `lore setup`)
├── auth.json             # Auth session token (created by `lore auth login`)
└── sync-sources.json     # Sync source directories

~/lore-data/              # Your data repo (separate git repo)
├── sources/              # Ingested documents (git-tracked)
├── retained/             # Explicitly saved insights (git-tracked)
└── archived-projects.json

Supabase (cloud):         # Vector index - shared across all machines
├── sources table         # Document metadata + embeddings + user_id (RLS)
└── chunks table          # Quotes/chunks + embeddings + user_id (RLS)
```

## Implementation Status

All 9 MCP tools and core features are implemented:

- **Universal Sync**: Two-phase sync with content hash deduplication
- **CLI Commands**: `sync`, `sources`, `search`, `projects`, `mcp`, `auth login`, `auth logout`, `auth whoami`, `setup`
- **MCP Tools**: All 10 tools fully functional
- **LLM-powered Research**: Uses Claude for extraction and research
- **Multi-machine Support**: Content hash dedup works across machines
- **Multi-tenant Auth**: Supabase Auth (email OTP) with RLS data isolation

## Usage

```bash
# First-time setup (config + login in one wizard)
lore setup

# Or configure manually:
lore auth login --email user@example.com
lore auth whoami

# Configure sync sources
lore sources add --name "Granola Meetings" --path ~/granola-extractor/output --glob "**/*.md" --project meetings

# Sync all sources (two-phase: discovery then processing)
lore sync

# Search
lore search "user pain points"

# Start MCP server
lore mcp

# Auth commands
lore auth login       # Sign in with email OTP
lore auth logout      # Clear session
lore auth whoami      # Show current user/status
lore setup            # Guided wizard (config + login + claim data)
```

## Universal Sync (Two-Phase)

The sync system uses a two-phase approach for efficiency:

**Phase 1: Discovery (NO LLM calls - essentially free)**
```
For each configured source:
  1. Glob files matching pattern
  2. Read raw file bytes, compute SHA256 hash
  3. Check Supabase: does this hash exist?
  4. If exists: skip (already ingested)
  5. If new: add to processing queue

Output: "Found 47 files, 2 new"
```

**Phase 2: Processing (only for NEW files)**
```
For each new file:
  1. Pre-process content (JSONL → text, etc.) - IN MEMORY
  2. Claude extracts: title, summary, date, participants, content_type
  3. Generate embedding for summary
  4. Store in Supabase (with content_hash for dedup)
  5. Copy to lore-data/sources/{id}/
  6. Git commit + push
```

**Config location:** `~/.config/lore/sync-sources.json` (machine-specific)

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
2. **Universal sync**: Claude extracts metadata at ingest time, replacing bespoke adapters
3. **Content hash deduplication**: Same file = same hash, works per-user across machines
4. **Two-phase sync**: Discovery is free (no LLM), processing only for new files
5. **Citations are first-class**: Every Quote has a Citation linking to source
6. **Projects organize knowledge**: All sources associate with projects
7. **Config is machine-specific**: `~/.config/lore/` not in data repo
8. **Multi-tenant via RLS**: Postgres Row Level Security isolates user data; service key bypasses for admin/migration use

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

## Authentication & Multi-Tenancy

Lore supports **Supabase Auth with email OTP** for multi-tenant data isolation:

- **Auth flow**: `lore auth login` → enter email → receive OTP code → verify → session saved to `~/.config/lore/auth.json`
- **Session management**: Auto-refreshes tokens when near expiry (5-minute buffer)
- **Data isolation**: Postgres RLS policies on `sources` and `chunks` tables, scoped by `user_id`
- **Three client modes**:
  1. **Service key** (`SUPABASE_SERVICE_KEY` env var) — bypasses RLS, for admin/migration
  2. **Authenticated user** — publishable key + Bearer token, RLS applies
  3. **No auth** — throws helpful "run lore auth login" error
- **Existing data migration**: `lore setup` includes a "claim unclaimed data" step

## Non-Goals (Current Phase)

- Not a note-taking app (sources come from other tools)
- Not a real-time collaboration tool (async knowledge sharing)

See **[PLANNED_FEATURES.md](docs/PLANNED_FEATURES.md)** for future roadmap including team features and commercial plans.
