# Lore Knowledge Base

Lore is a research knowledge repository available via MCP. It stores documents, meeting notes, interviews, and decisions with full citations back to original sources. Use it to ground your work in evidence and preserve important context.

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

## When to Ingest

Use `ingest` to manage content in Lore. Actions: `add` (default), `update`, `delete`.

**Add** — push new content when:
- Working context should be preserved for future sessions
- Documents, specs, or research are shared that the team needs to reference later
- You encounter important external content (from integrations, web, etc.)

Always pass `source_url` (original URL for linking) and `source_name` (human-readable label like "GitHub PR #123") when available. Add is idempotent — safe to call repeatedly with the same content.

For short insights or decisions, title is optional:
```
ingest(content: "We chose JWT for auth", project: "auth-system")
```

**Update** — replace content on an existing source (requires `id` + `content`):
```
ingest(action: "update", id: "source-id", content: "Updated content...")
```

**Delete** — soft-delete a source (requires `id`, recoverable via `lore docs restore`):
```
ingest(action: "delete", id: "source-id")
```

## When to Use Briefs

**Start with `get_brief`** when working on a project. It gives you immediate context: current state, key evidence, open questions, and trajectory — without searching from scratch.

- If the brief exists and is current: use it as your foundation, then `search` for specifics
- If the brief is stale: it's still useful, but note the staleness and suggest `lore brief generate <project>` via CLI
- If no brief exists: fall back to `search`/`research`, or suggest `lore brief generate <project>` via CLI

## When to Search

Before making recommendations or answering questions about past work:
1. `get_brief` first if working within a project — it's the fastest way to get context
2. `search` for specific lookups. Use `since`/`before` for date filtering (e.g., `since: "7d"`, `since: "last week"`). Temporal queries ("latest", "most recent") auto-boost recent results.
3. Only use `research` if the question genuinely needs cross-referencing multiple sources. Use `depth: "quick"` for focused questions, `"deep"` for audits.
4. Use `get_source(id, include_content: true)` when you need the full text

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

## Logging Progress

Use `log` for quick status updates, decisions, and progress notes during work sessions:
```
log(message: "Decided to use JWT for auth", project: "auth-system")
log(message: "Finished implementing the export module", project: "data-pipeline")
```

Log entries are:
- Searchable via `search` and included in project briefs
- Hidden from `list_sources` by default (pass `include_logs: true` to see them)
- Lightweight — no extraction overhead, just embedding for search
