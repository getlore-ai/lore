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

# Configure MCP (add to Claude Desktop or Claude Code config)
{
  "mcpServers": {
    "lore": {
      "command": "node",
      "args": ["/path/to/lore/dist/mcp/server.js"],
      "env": {
        "OPENAI_API_KEY": "your-key",
        "LORE_DATA_DIR": "/path/to/data"
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
| `get_quotes` | Find citable quotes by theme |
| `list_projects` | Project overview with stats |
| `retain` | Explicitly save insights |

### Agentic Research

| Tool | Description |
|------|-------------|
| `research` | Comprehensive research with synthesis and citations |

## Supported Sources

- **Granola** - Meeting transcripts with speaker attribution
- **Claude Code** - Conversation histories (coming soon)
- **Claude Desktop** - Exports (coming soon)
- **Markdown** - Documents and notes

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
