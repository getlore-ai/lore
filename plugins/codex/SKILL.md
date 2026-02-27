---
name: lore
description: Search and ingest knowledge from Lore — a research repository with citations and semantic search
---

# Lore Knowledge Base

Lore is a research knowledge repository available via MCP. It stores documents, meeting notes, interviews, and decisions with full citations back to original sources. Use it to ground your work in evidence and preserve important context.

## First-Time Setup

If Lore is not installed yet, you can set it up for the user.

1. **Install**: `npm install -g @getlore/cli` (requires Node.js 18+)
2. **Ask the user** for their **email address**
3. **Ask for API keys** — present these two options:
   - **Recommended**: Tell the user to run these commands themselves (keys stay out of chat history):
     ```
     export OPENAI_API_KEY="sk-..."
     export ANTHROPIC_API_KEY="sk-ant-..."
     ```
     Then run: `lore setup --openai-key $OPENAI_API_KEY --anthropic-key $ANTHROPIC_API_KEY --email <email> --data-dir ~/.lore`
   - **Convenient but riskier**: The user can paste keys directly into this chat and you run setup with them. Warn the user that keys shared in chat may be stored in conversation history.
4. **Send OTP**: Run the setup command — this sends a 6-digit code to their email and exits
5. **Ask the user** for the **6-digit code** from their email
6. **Complete setup**: Re-run the same command with `--code <code>` appended

After setup, Lore works autonomously.

## MCP Tools

| Tool | Cost | Use For |
|------|------|---------|
| `search` | Low | Quick lookups with date filtering (`since`/`before`/`sort`) |
| `get_source` | Low | Full document retrieval by ID |
| `list_sources` | Low | Browse what exists in a project |
| `list_projects` | Low | Discover available knowledge domains |
| `get_brief` | Low | Get the living project brief — start here for project context |
| `log` | Low | Log entries: add/update/delete (hidden from list_sources by default) |
| `ingest` | Low-Medium | Manage content — add/update/delete documents, insights, or decisions |
| `research` | High | Cross-reference sources, synthesize (depth: quick/standard/deep) |
| `research_status` | Low | Poll for research results (long-polls up to 20s) |

## When to Use Briefs

**Start with `get_brief`** when working on a project. It gives you immediate context: current state, key evidence, open questions, and trajectory — without searching from scratch.

- If the brief exists and is current: use it as your foundation, then `search` for specifics
- If the brief is stale: it's still useful, but note the staleness and suggest `lore brief generate <project>` via CLI
- If no brief exists: fall back to `search`/`research`, or suggest `lore brief generate <project>` via CLI

## When to Ingest

Use `ingest` to manage content in Lore. Actions: `add` (default), `update` (requires `id` + `content`), `delete` (requires `id`, soft-deletes — recoverable via CLI). Always pass `source_url` and `source_name` when available. Add is idempotent (SHA256 dedup).

## When to Search

Before making recommendations or answering questions about past work:
1. `get_brief` first if working within a project — it's the fastest way to get context
2. `search` for specific lookups. Use `since`/`before` for date filtering (e.g., `since: "7d"`). Temporal queries auto-boost recent results.
3. Only use `research` for multi-source synthesis (10x more expensive). Use `depth: "quick"` for focused questions, `"deep"` for audits.
4. Use `get_source(id, include_content: true)` for full text

## Logging Progress

Use `log` for quick status updates, decisions, and progress notes during work sessions:
```
log(message: "Decided to use JWT for auth", project: "auth-system")
```

Log entries are searchable via `search` and included in project briefs. They are hidden from `list_sources` by default.

For short insights or decisions, just pass the content — title and source_type are optional and auto-generated from content.
