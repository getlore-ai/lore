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

## Installation

### 1. Clone and Build

```bash
git clone https://github.com/mishkinf/lore.git
cd lore
npm install
npm run build
```

### 2. Make `lore` Command Available Globally

```bash
npm link
```

This creates a symlink so you can run `lore` from anywhere. Verify it works:

```bash
lore --version
# Should output: 0.1.0
```

### 3. Configure Environment

```bash
cp .env.example .env.local
```

Edit `.env.local` with your API keys (see below).

### 4. Set Up Data Directory

```bash
# Create a data directory (can be its own git repo for multi-machine sync)
mkdir ~/lore-data

# Or initialize with git for cross-machine sync
lore init ~/lore-data --remote git@github.com:you/lore-data-private.git
```

### 5. Configure Sync Sources

```bash
# Add directories to watch
lore sync add --name "My Notes" --path ~/Documents/notes --glob "**/*.md" --project myproject

# Verify
lore sync list
```

### 6. Start the Daemon

```bash
lore sync start
```

---

## Environment Variables

```bash
OPENAI_API_KEY=...              # Required for embeddings
ANTHROPIC_API_KEY=...           # Required for sync metadata extraction & research
SUPABASE_URL=...                # Supabase project URL
SUPABASE_ANON_KEY=...           # Supabase anon/service key
LORE_DATA_DIR=~/lore-data       # Data directory for raw documents
```

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

## CLI Overview

```
lore
├── sync                    # Sync (daemon, sources, import)
├── search <query>          # Search documents
├── research <query>        # Deep AI research
├── browse                  # Interactive TUI
├── docs                    # Document CRUD
│   ├── list
│   ├── get <id>
│   ├── create <content>
│   └── delete <id>
├── projects                # Project management
│   ├── list (default)
│   ├── archive <name>
│   └── delete <name>
├── init [path]             # Initialize data repo
└── serve                   # Start MCP server
```

## CLI Commands

### Sync

```bash
# One-time sync
lore sync                   # Sync all sources
lore sync --dry-run         # Preview what would sync

# Background daemon
lore sync start             # Start daemon
lore sync stop              # Stop daemon
lore sync restart           # Restart daemon
lore sync status            # Check if running
lore sync logs              # View last 50 log entries
lore sync logs -f           # Follow logs in real-time

# Foreground watch
lore sync watch             # Watch with live output

# Source management
lore sync list              # List configured sources
lore sync add               # Add a new source
lore sync enable <name>     # Enable a source
lore sync disable <name>    # Disable a source
lore sync remove <name>     # Remove a source

# Bulk import (legacy)
lore sync import <path> -t markdown -p myproject
```

The daemon:
- Watches configured directories for new/changed files
- Pulls from git every 5 minutes (gets files from other machines)
- Pushes to git after processing new files
- Logs all activity to `~/.config/lore/daemon.log`

### Search

```bash
# Quick search (hybrid semantic + keyword)
lore search "user pain points"

# Semantic only (conceptual matching)
lore search "user frustration" --mode semantic

# Keyword only (exact terms)
lore search "OAuth config" --mode keyword

# Regex (grep local files)
lore search "OAuth.*error" --mode regex

# Filter by project
lore search "onboarding issues" -p myproject
```

### Research

```bash
# Deep AI-powered research with citations
lore research "What authentication approach should we use?"

# Focus on specific project
lore research "user feedback on exports" -p myproject

# Simple mode (faster, single-pass)
lore research "pricing concerns" --simple
```

### Documents

```bash
# List all documents
lore docs list
lore docs list -p myproject    # Filter by project

# Get document details
lore docs get <id>
lore docs get <id> --content   # Include full content

# Create a note/insight
lore docs create "Decision: Using JWT for auth" -p myproject -t decision

# Delete a document
lore docs delete <id>
lore docs delete <id> --force  # Skip confirmation
```

### Projects

```bash
# List all projects
lore projects

# Archive a project (hide from search)
lore projects archive old-project
lore projects archive old-project --successor new-project

# Delete a project and all its documents
lore projects delete old-project
```

### Browse (Interactive TUI)

```bash
lore browse                    # Browse all documents
lore browse -p myproject       # Filter by project
lore browse -t meeting         # Filter by type
```

**Keyboard shortcuts:**

| Key | Action |
|-----|--------|
| `j/k` or `↑/↓` | Navigate documents |
| `Enter` | View full document |
| `/` | Hybrid search (semantic + keyword) |
| `:` | Regex search (grep files) |
| `s` | Sync now |
| `e` | Open in $EDITOR |
| `?` | Help |
| `q` | Quit |

**In document view:**

| Key | Action |
|-----|--------|
| `j/k` | Scroll up/down |
| `/` | Search in document (regex) |
| `n/N` | Next/previous match |
| `Esc` | Clear search / back to list |

### Infrastructure

```bash
# Initialize data repository
lore init ~/lore-data
lore init ~/lore-data --remote git@github.com:you/lore-data.git

# Start MCP server
lore serve
```

## MCP Tools

### Simple Query Tools

| Tool | Description |
|------|-------------|
| `search` | Hybrid search (semantic + keyword) with mode selection |
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

## How Search Works

Lore uses **Reciprocal Rank Fusion (RRF)** to combine semantic and keyword search:

```
┌─────────────────────────────────────────────────────────────┐
│                     HYBRID SEARCH                            │
│                                                              │
│   Query: "OAuth authentication issues"                       │
│              │                                               │
│    ┌─────────┴─────────┐                                    │
│    ▼                   ▼                                    │
│  Semantic            Keyword                                │
│  (pgvector)          (tsvector)                            │
│    │                   │                                    │
│    └─────────┬─────────┘                                    │
│              ▼                                               │
│     Reciprocal Rank Fusion                                  │
│     score = 1/(rank_sem + 60) + 1/(rank_kw + 60)           │
│              │                                               │
│              ▼                                               │
│       Merged Results                                         │
└─────────────────────────────────────────────────────────────┘
```

This gives you the best of both worlds:
- Semantic finds conceptually similar content
- Keyword finds exact term matches
- RRF boosts documents that rank highly in both

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
└── ~/.config/lore/      - Machine-specific config & daemon state
```

## Supported File Formats

The universal sync system handles:

**Text formats:**
- **Markdown** (`.md`) - Documents, notes, research
- **JSONL** (`.jsonl`) - Claude Code conversations, chat logs
- **JSON** (`.json`) - Granola exports, structured data
- **Plain text** (`.txt`) - Any text content
- **CSV** (`.csv`) - Spreadsheets, data exports
- **HTML** (`.html`, `.htm`) - Web pages, saved articles
- **XML** (`.xml`) - Structured data

**Documents:**
- **PDF** (`.pdf`) - Text extracted automatically

**Images** (described by Claude Vision):
- **JPEG** (`.jpg`, `.jpeg`)
- **PNG** (`.png`)
- **GIF** (`.gif`)
- **WebP** (`.webp`)

Claude automatically extracts metadata and classifies content type (interview, meeting, document, note, analysis, etc.).

## License

MIT
