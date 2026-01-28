# Lore

> The lore behind your projects.

A research knowledge repository with semantic search, citations, and project lineage tracking. Unlike memory systems that store processed facts, Lore preserves your original sources (interviews, conversations, documents) with extracted insights that link back for citation.

## Why Lore?

When doing user research and rapid prototyping, you need:

- **Citations**: "In the Jan 15 interview, Sarah said '...'" not just "users want faster exports"
- **Full context**: Access original transcripts when you need to dig deeper
- **Cross-tool access**: Same knowledge base from Claude Code, Claude Desktop, or custom agents
- **Project organization**: Group knowledge by project with lineage tracking

## Quick Start

```bash
# Install dependencies
npm install

# Build
npm run build
```

### Data Repository Setup

**Important:** Lore separates code from data. Your knowledge is stored in a separate data directory (optionally its own git repo for syncing across machines).

```bash
# Copy the template to your desired location
cp -r /path/to/lore/data-repo-template ~/lore-data
cd ~/lore-data

# Initialize git and commit
git init
git add . && git commit -m "Initial lore data repo"

# (Optional) Push to private remote for cross-machine sync
git remote add origin git@github.com:you/lore-data-private.git
git push -u origin main
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
        "LORE_DATA_DIR": "/path/to/your/lore-data"
      }
    }
  }
}
```

The data directory contains:
- `sources/` - Ingested source documents (git-tracked)
- `retained/` - Explicitly retained insights (git-tracked)
- `lore.lance/` - Vector index (git-ignored, rebuilt with `lore sync`)
- `archived-projects.json` - Archived project list (git-tracked)

## MCP Tools

### Simple Query Tools

| Tool | Description |
|------|-------------|
| `search` | Semantic search across all sources |
| `get_source` | Full source document with content |
| `list_sources` | Browse by project or type |
| `get_quotes` | Find citable quotes by theme |
| `list_projects` | Project overview with stats |
| `retain` | Explicitly save insights |
| `sync` | Refresh index from disk (optional git pull) |
| `archive_project` | Archive a project (excludes from search) |

### Agentic Research

| Tool | Description |
|------|-------------|
| `research` | Comprehensive research with synthesis and citations |

## Supported Sources

- **Granola** - Meeting transcripts with speaker attribution
- **Claude Code** - Conversation histories from `~/.claude/projects/`
- **Markdown** - Any documents (research, competitor analysis, ChatGPT dumps, etc.)

## CLI Commands

```bash
# Ingest Granola meeting exports
lore ingest /path/to/granola-exports --type granola -p myproject

# Ingest Claude Code conversations
lore ingest ~/.claude/projects --type claude-code -p myproject

# Ingest markdown documents (competitor analyses, ChatGPT context dumps, specs, etc.)
lore ingest /path/to/docs --type markdown -p myproject

# Search from command line
lore search "user pain points with onboarding"

# List projects
lore projects

# Rebuild index
lore sync

# Start MCP server
lore mcp
```

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
```

## License

MIT
