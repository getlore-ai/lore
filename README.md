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
lore sources add --name "My Notes" --path ~/Documents/notes --glob "**/*.md" --project myproject

# Verify
lore sources list
```

### 6. Start Watching

```bash
lore watch
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

# Watch directories and auto-sync on changes
lore watch

# Manage sync sources
lore sources list
lore sources add
lore sources enable <name>
lore sources disable <name>
lore sources remove <name>

# Search from command line
lore search "user pain points with onboarding"

# View a specific source
lore get <source-id>

# List all sources
lore list

# Save an insight
lore retain "Decision: Using JWT for auth because..."

# Run research query
lore research "What do users say about pricing?"

# List projects
lore projects

# Archive a project
lore archive <project-name>

# Start MCP server
lore mcp

# Legacy: Direct ingest (still works)
lore ingest /path/to/docs --type markdown -p myproject
```

## Syncing

### `lore watch` (Recommended)

```bash
lore watch
```

The primary way to keep Lore in sync. Run it in a terminal:
- Watches configured directories for new/changed files
- Pulls from git every 5 minutes (gets files from other machines)
- Pushes to git after processing new files
- Shows colorized real-time progress

Run in background: `nohup lore watch > ~/lore-watch.log 2>&1 &`

### Other Options

| Method | When to use |
|--------|-------------|
| `lore watch` | **Primary** - run in terminal for full visibility |
| `lore sync` | One-time manual sync |
| MCP server | Disabled by default. Set `LORE_AUTO_SYNC=true` to enable |

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
