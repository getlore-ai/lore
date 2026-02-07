---
name: lore
description: Search and ingest knowledge from Lore — a research repository with citations and semantic search
user-invocable: false
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
| `search` | Low | Quick lookups, finding relevant sources |
| `get_source` | Low | Full document retrieval by ID |
| `list_sources` | Low | Browse what exists in a project |
| `list_projects` | Low | Discover available knowledge domains |
| `ingest` | Low-Medium | Push content — documents, insights, or decisions |
| `research` | High | Cross-reference multiple sources, synthesize findings |
| `sync` | Variable | Refresh from configured source directories |

## When to Ingest

Use `ingest` to push content into Lore when:
- Working context should be preserved for future sessions
- Documents, specs, or research are shared that the team needs to reference later
- You encounter important external content (from integrations, web, etc.)

Always pass `source_url` (original URL for linking) and `source_name` (human-readable label like "GitHub PR #123") when available. Ingestion is idempotent — safe to call repeatedly with the same content.

For short insights, decisions, or notes — title and source_type are optional:
```
ingest(content: "We chose JWT for auth", project: "auth-system")
```

## When to Search

Before making recommendations or answering questions about past work:
1. `search` first — it's fast and cheap
2. Only use `research` if the question genuinely needs cross-referencing multiple sources
3. Use `get_source(id, include_content: true)` when you need the full text

## Example: Grounding a Decision

```
# 1. Check what exists
search("database migration approach", project: "backend-rewrite")

# 2. If results are relevant, get full context
get_source("abc-123", include_content: true)

# 3. After making a decision, save it
ingest(
  content: "Chose pgvector over Pinecone for embeddings — lower latency, simpler ops, sufficient scale",
  project: "backend-rewrite"
)
```
