---
name: lore
description: Search and ingest knowledge from Lore, a research repository with citations
version: "1.0"
user-invocable: false
---

# Lore Knowledge Base

Lore is a research knowledge repository you have access to via MCP tools. It stores documents, meeting notes, interviews, and decisions with full citations — not just summaries, but the original content linked back to its source. Use it to ground your answers in evidence and to preserve important context from your conversations.

## When to Use Briefs

**Start with `get_brief`** when working on a project. It gives you immediate context: current state, key evidence, open questions, and trajectory — without searching from scratch.

- If the brief exists and is current: use it as your foundation, then `search` for specifics
- If the brief is stale: it's still useful, but note the staleness and suggest `lore brief generate <project>` via CLI
- If no brief exists: fall back to `search`/`research`, or suggest `lore brief generate <project>` via CLI

## When to Ingest Content into Lore

Use the `ingest` tool to manage content. Actions: `add` (default), `update`, `delete`.

**Add** — push new content whenever you encounter information worth preserving:
- **After conversations**: When a user shares meeting notes, interview transcripts, or important documents, ingest them so they're searchable later.
- **External content**: When you fetch content from Slack, Notion, GitHub, email, or other systems, ingest the relevant parts into Lore.
- **Decisions and context**: When important decisions are made or context is shared that future conversations will need.

Always include:
- `source_url`: The original URL (Slack permalink, Notion page URL, GitHub issue URL) for citation linking.
- `source_name`: A human-readable label like "Slack #product-team" or "GitHub issue #42".
- `project`: The project this content belongs to.

Add is idempotent — calling `ingest` with the same content twice is safe and cheap (returns immediately with `deduplicated: true`).

**Update** — replace content on an existing source: `ingest(action: "update", id: "source-id", content: "...")`

**Delete** — soft-delete a source (recoverable via CLI): `ingest(action: "delete", id: "source-id")`

## When to Search Lore

Before answering questions about past decisions, user feedback, project history, or anything that might already be documented:

1. **Start with `get_brief`** if working within a project — it's the fastest way to get context.

2. **Use `search`** for quick lookups. Pick the right mode:
   - `hybrid` (default): Best for most queries
   - `keyword`: For exact terms, names, identifiers
   - `semantic`: For conceptual queries ("user frustrations", "pain points")

3. **Use `research`** only when the question requires cross-referencing multiple sources or synthesizing findings. It costs 10x more than `search` — don't use it for simple lookups. Use `depth: "quick"` for focused questions, `"deep"` for comprehensive audits.

4. **Use `get_source`** with `include_content=true` when you need the full original text of a specific document.

5. **Temporal queries**: Queries like "latest" or "most recent" automatically boost recent sources. Use `since`/`before` for explicit date filtering (e.g., `since: "7d"`, `since: "last week"`).

## Logging Progress

Use `log` for quick status updates, decisions, and progress notes during work sessions:
```
log(message: "Decided to use JWT for auth", project: "auth-system")
log(message: "Finished implementing the export module", project: "data-pipeline")
```

Log entries are searchable via `search` and included in project briefs. They are hidden from `list_sources` by default (pass `include_logs: true` to see them).

## Short Content

For short insights, decisions, or notes — title and source_type are optional:
```
ingest(content: "We chose X because Y", project: "my-project")
```

## Citation Best Practices

When presenting information from Lore, always cite your sources:
- Reference the source title and date
- Quote directly when possible
- If a `source_url` is available, link to the original

## Example Workflows

**User asks about past decisions:**
1. `get_brief("my-app")` — check for existing context
2. `search("authentication approach decisions", project: "my-app")`
3. Review results, get full source if needed: `get_source(source_id, include_content: true)`
4. Present findings with citations

**User shares meeting notes:**
1. `ingest(content: "...", title: "Sprint Planning Jan 15", project: "my-app", source_type: "meeting", source_name: "Google Meet", participants: ["Alice", "Bob"])`
2. Confirm ingestion to user

**User asks a broad research question:**
1. `research(task: "What do users think about our onboarding flow?", project: "my-app", depth: "standard")`
2. Present the synthesized findings with citations
