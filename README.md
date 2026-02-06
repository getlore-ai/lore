# Lore

> The lore behind your projects.

A research knowledge repository with **semantic search** and **citations**. Unlike memory systems that store processed facts, Lore preserves your original sources and lets you cite exactly what was said, by whom, and when.

## Quick Start

```bash
npm install -g @getlore/cli

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

**One-click install:**

[![Install in Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/en-US/install-mcp?name=lore&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBnZXRsb3JlL2NsaSIsIm1jcCJdfQ%3D%3D)
[![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_Server-0098FF?style=flat-square&logo=visualstudiocode&logoColor=white)](https://insiders.vscode.dev/redirect/mcp/install?name=lore&config=%7B%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40getlore%2Fcli%22%2C%22mcp%22%5D%7D)
[![Install in VS Code Insiders](https://img.shields.io/badge/VS_Code_Insiders-Install_Server-24bfa5?style=flat-square&logo=visualstudiocode&logoColor=white)](https://insiders.vscode.dev/redirect/mcp/install?name=lore&config=%7B%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40getlore%2Fcli%22%2C%22mcp%22%5D%7D&quality=insiders)
[![Install in Goose](https://img.shields.io/badge/Goose-Install_Extension-F97316?style=flat-square&logoColor=white)](goose://extension?cmd=npx&arg=-y&arg=%40getlore%2Fcli&arg=mcp&timeout=300&id=lore-mcp&name=Lore&description=Research%20knowledge%20repository%20with%20semantic%20search%20and%20citations)

After installing, run `npx @getlore/cli setup` to configure API keys and sign in.

**Manual config** — add to your MCP client config (`.mcp.json`, `.cursor/mcp.json`, etc.):

```json
{
  "mcpServers": {
    "lore": {
      "command": "npx",
      "args": ["-y", "@getlore/cli", "mcp"]
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

## Agent Platform Install

Lore works with any agent that supports MCP. Use `lore skills install` or install directly from your platform's registry.

### Claude Code

```bash
# From plugin directory (once approved)
/plugin install lore

# Or install directly from GitHub
/plugin install https://github.com/getlore-ai/lore/tree/main/plugins/claude-code

# Or via Lore CLI
lore skills install claude-code
```

### Gemini CLI

```bash
# From Extensions Gallery
gemini extensions install lore

# Or install directly from GitHub
gemini extensions install https://github.com/getlore-ai/lore --path plugins/gemini

# Or via Lore CLI
lore skills install gemini
```

### Codex CLI

```bash
# Add MCP server
codex mcp add lore -- npx -y @getlore/cli mcp

# Install skill
lore skills install codex
```

### OpenClaw

```bash
# From ClawHub
clawhub install lore

# Or via Lore CLI
lore skills install openclaw
```

## License

MIT
