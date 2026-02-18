# Lore Knowledge Base

Lore is a research knowledge repository available via MCP. It stores documents, meeting notes, interviews, and decisions with full citations back to original sources. Use it to ground your work in evidence and preserve important context.

## MCP Tools

| Tool | Cost | Use For |
|------|------|---------|
| `search` | Low | Quick lookups with date filtering (`since`/`before`/`sort`) |
| `get_source` | Low | Full document retrieval by ID |
| `list_sources` | Low | Browse what exists in a project |
| `list_projects` | Low | Discover available knowledge domains |
| `ingest` | Low-Medium | Push content — documents, insights, or decisions |
| `research` | High | Cross-reference sources, synthesize (depth: quick/standard/deep) |
| `sync` | Variable | Refresh from configured source directories |

## When to Ingest

Use `ingest` to push content into Lore when:
- Working context should be preserved for future sessions
- Documents, specs, or research are shared that the team needs to reference later
- You encounter important external content (from integrations, web, etc.)

Always pass `source_url` (original URL for linking) and `source_name` (human-readable label like "GitHub PR #123") when available. Ingestion is idempotent — safe to call repeatedly with the same content.

For short insights or decisions, title is optional:
```
ingest(content: "We chose JWT for auth", project: "auth-system")
```

## When to Search

Before making recommendations or answering questions about past work:
1. `search` first — it's fast and cheap. Use `since`/`before` for date filtering (e.g., `since: "7d"`, `since: "last week"`). Temporal queries ("latest", "most recent") auto-boost recent results.
2. Only use `research` if the question genuinely needs cross-referencing multiple sources. Use `depth: "quick"` for focused questions, `"deep"` for audits.
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
