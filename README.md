# Lore

> The lore behind your projects.

A research knowledge repository with semantic search, citations, and project lineage tracking. Unlike memory systems that store processed facts, Lore preserves your original sources (interviews, conversations, documents) with extracted insights that link back for citation.

## Why Lore?

When doing user research and rapid prototyping, you need:

- **Citations**: "In the Jan 15 interview, Sarah said '...'" not just "users want faster exports"
- **Full context**: Access original transcripts when you need to dig deeper
- **Cross-tool access**: Same knowledge base from Claude Code, Claude Desktop, or custom agents
- **Multi-machine sync**: Content hash deduplication across all your machines
- **Project organization**: Group knowledge by project with lineage tracking

## Quick Start

```bash
# Install dependencies
npm install

# Build
npm run build

# Set up environment
cp .env.example .env.local
# Edit .env.local with your API keys
```

### Environment Variables

```bash
OPENAI_API_KEY=...              # Required for embeddings
ANTHROPIC_API_KEY=...           # Required for sync metadata extraction & research
SUPABASE_URL=...                # Supabase project URL
SUPABASE_ANON_KEY=...           # Supabase anon/service key
LORE_DATA_DIR=~/lore-data       # Data directory for raw documents
```

### Data Repository Setup

Lore separates code from data. Your knowledge is stored in a separate data directory (optionally its own git repo for syncing across machines).

```bash
# Initialize a new data repository
lore init ~/lore-data

# Or with a git remote for cross-machine sync
lore init ~/lore-data --remote git@github.com:you/lore-data-private.git
```

### Configure Sync Sources

Tell Lore where to find your documents:

```bash
# Add directories to watch
lore sources add --name "Granola Meetings" --path ~/granola-extractor/output --glob "**/*.md" --project meetings
lore sources add --name "Research Notes" --path ~/research --glob "**/*.{md,txt}" --project research

# List configured sources
lore sources list

# Enable/disable sources
lore sources disable "Granola Meetings"
lore sources enable "Granola Meetings"
```

Config is stored at `~/.config/lore/sync-sources.json` (machine-specific, not in data repo).

### MCP Configuration

```json
{
  "mcpServers": {
    "lore": {
      "command": "node",
      "args": ["/path/to/lore/dist/mcp/server.js"],
      "env": {
        "OPENAI_API_KEY": "your-key",
        "ANTHROPIC_API_KEY": "your-key",
        "SUPABASE_URL": "your-url",
        "SUPABASE_ANON_KEY": "your-key",
        "LORE_DATA_DIR": "/path/to/your/lore-data"
      }
    }
  }
}
```

## MCP Tools

### Simple Query Tools

| Tool | Description |
|------|-------------|
| `search` | Semantic search across all sources |
| `get_source` | Full source document with content |
| `list_sources` | Browse by project or type |
| `list_projects` | Project overview with stats |
| `retain` | Explicitly save insights/decisions |
| `ingest` | Add documents directly via MCP |
| `sync` | Two-phase sync (discovery + processing) |
| `archive_project` | Archive a project (excludes from search) |

### Agentic Research

| Tool | Description |
|------|-------------|
| `research` | Comprehensive research with synthesis and citations |

## CLI Commands

```bash
# Sync sources (two-phase: discovery then processing)
lore sync

# Dry run - see what would be synced
lore sync --dry-run

# Manage sync sources
lore sources list
lore sources add
lore sources enable <name>
lore sources disable <name>
lore sources remove <name>

# Search from command line
lore search "user pain points with onboarding"

# List projects
lore projects

# Start MCP server
lore mcp

# Legacy: Direct ingest (still works)
lore ingest /path/to/docs --type markdown -p myproject
```

## How Sync Works

Lore uses a **two-phase sync** for efficiency:

### Phase 1: Discovery (FREE - no LLM calls)
```
For each configured source directory:
  1. Find files matching glob pattern
  2. Compute SHA256 hash of each file
  3. Check Supabase: does this hash exist?
  4. If yes: skip (already indexed)
  5. If no: queue for processing
```

### Phase 2: Processing (only NEW files)
```
For each new file:
  1. Pre-process content (JSONL → text, etc.)
  2. Claude extracts: title, summary, date, participants, content_type
  3. Generate embedding
  4. Store in Supabase with content_hash
  5. Copy to lore-data/sources/
```

**Multi-machine deduplication**: Same file content = same hash, regardless of path or machine. If you sync the same file on two machines, only the first one is processed.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         Lore                                 │
├─────────────────────────────────────────────────────────────┤
│ Sources        │ Insights          │ Context                │
│ (immutable)    │ (with citations)  │ (for agents)           │
├────────────────┼───────────────────┼────────────────────────┤
│ Transcripts    │ Quotes            │ Research packages      │
│ Conversations  │ Themes            │ Project summaries      │
│ Documents      │ Decisions         │ Delegation context     │
└────────────────┴───────────────────┴────────────────────────┘

Storage:
├── Supabase (cloud)     - Vector embeddings + metadata (shared across machines)
├── lore-data/ (git)     - Raw documents (synced via git)
└── ~/.config/lore/      - Machine-specific sync config
```

## Supported File Formats

The universal sync system handles:

- **Markdown** (`.md`) - Documents, notes, research
- **JSONL** (`.jsonl`) - Claude Code conversations, chat logs
- **JSON** (`.json`) - Granola exports, structured data
- **Plain text** (`.txt`) - Any text content

Claude automatically extracts metadata and classifies content type (interview, meeting, document, note, analysis, etc.).

## License

MIT
