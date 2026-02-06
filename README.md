# Lore

> The lore behind your projects.

A research knowledge repository with **semantic search** and **citations**. Unlike memory systems that store processed facts, Lore preserves your original sources and lets you cite exactly what was said, by whom, and when.

## Quick Start

```bash
npm install -g @mishkinf/lore

# Setup (API keys + login)
lore setup

# Add a source directory (interactive prompts)
lore sync add

# Sync and search
lore sync
lore search "user pain points"
```

## What It Does

- **Hybrid Search** — Semantic + keyword search with Reciprocal Rank Fusion
- **Citations** — Every insight links back to the original source with context
- **MCP Integration** — 9 tools for Claude Desktop and Claude Code
- **Agentic Research** — Claude iteratively explores your knowledge, synthesizes findings with citations
- **Multi-Machine Sync** — Content hash deduplication across machines
- **Universal Formats** — Markdown, JSONL, JSON, PDF, images, CSV, HTML, and more

## MCP Configuration

Add to your Claude Code or Claude Desktop MCP config:

```json
{
  "mcpServers": {
    "lore": {
      "command": "lore",
      "args": ["mcp"]
    }
  }
}
```

If the MCP host doesn't inherit your shell environment (e.g. Claude Desktop), add your API keys to the `env` block.

## CLI Commands

| Command | Description |
|---------|-------------|
| `lore setup` | Guided configuration wizard |
| `lore login` | Sign in with email OTP |
| `lore sync` | Sync all configured sources |
| `lore sync add` | Add a source directory |
| `lore search <query>` | Hybrid search |
| `lore research <query>` | AI-powered deep research |
| `lore browse` | Interactive TUI browser |
| `lore docs list` | List documents |
| `lore projects` | List projects |
| `lore mcp` | Start MCP server |

## Requirements

- **Node.js** 18+
- **OpenAI API key** (embeddings)
- **Anthropic API key** (metadata extraction & research)
- **Lore account** (free — sign up via `lore login`)

## How Sync Works

1. **Discovery** (free) — Finds files, computes SHA256 hashes, checks for duplicates
2. **Processing** (new files only) — Claude extracts metadata, OpenAI generates embeddings, stores in Supabase

Same content on different machines produces the same hash — no duplicate processing.

## License

MIT
