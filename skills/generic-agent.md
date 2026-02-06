# Lore Knowledge Base — Agent Instructions

Lore is a research knowledge repository accessible via MCP (Model Context Protocol). It stores documents with full-text search, semantic search, and citation tracking. Content is deduplicated, embedded for retrieval, and organized by project.

## Core Concepts

- **Sources**: Full documents (meeting notes, interviews, Slack threads, specs, etc.)
- **Projects**: Organizational grouping for sources
- **Insights**: Short retained knowledge (decisions, requirements, observations)
- **Citations**: Every piece of knowledge links back to its original source

## Tools Reference

### `ingest` — Push content into Lore
The primary way to add content. Accepts any document with metadata.

```json
{
  "content": "Full document text...",
  "title": "Sprint Planning — Jan 15",
  "project": "my-project",
  "source_type": "meeting",
  "source_url": "https://meet.google.com/abc-123",
  "source_name": "Google Meet",
  "participants": ["Alice", "Bob"],
  "tags": ["sprint", "planning"]
}
```

- **Idempotent**: Duplicate content returns `{deduplicated: true}` with no processing cost.
- **source_type**: Free-form string. Common values: `meeting`, `interview`, `document`, `notes`, `analysis`, `conversation`, `slack`, `email`, `github-issue`, `notion`.
- **source_url**: Always pass when available — enables citation linking.
- **source_name**: Human-readable origin label.

### `search` — Find relevant sources
Fast lookup. Returns summaries with relevance scores.

```json
{
  "query": "user feedback on export speed",
  "project": "my-project",
  "mode": "hybrid",
  "limit": 5
}
```

Modes:
- `hybrid` (default): Combined vector + full-text search. Best for most queries.
- `semantic`: Vector similarity only. For conceptual queries.
- `keyword`: Full-text only. For exact terms, names, identifiers.
- `regex`: Pattern matching. For code patterns or complex text matching.

### `get_source` — Retrieve full document
Get complete details of a source by ID. Set `include_content: true` for the full text.

### `list_sources` — Browse sources
List sources filtered by project or type. Sorted by date (newest first).

### `list_projects` — Discover projects
Lists all projects with source counts and activity dates.

### `retain` — Save discrete knowledge
For short insights, decisions, or requirements — not full documents.

```json
{
  "content": "Users consistently report export takes >30s for large datasets",
  "project": "my-project",
  "type": "insight",
  "source_context": "User interview synthesis — Jan batch"
}
```

### `research` — Deep research with citations
Runs an internal agent that iteratively searches, reads, and synthesizes findings.

```json
{
  "task": "What authentication approach should we use based on user feedback?",
  "project": "my-project"
}
```

**Cost warning**: Makes 3-8 internal LLM calls. Use `search` for simple lookups.

### `sync` — Refresh from source directories
Scans configured directories for new files. Use `ingest` for agent-pushed content instead.

### `archive_project` — Archive a project
Excludes from default search. Only use when explicitly requested.

## Best Practices

1. **Search before you answer**: If a question might have documented context, search Lore first.
2. **Ingest what matters**: After meaningful conversations or when processing external content, ingest it.
3. **Always pass source_url**: Enables citation linking back to the original.
4. **Use retain for synthesis**: After analyzing multiple sources, retain the key insight.
5. **Prefer search over research**: `search` is 10x cheaper. Only use `research` for multi-source synthesis.
6. **Cite your sources**: When presenting Lore results, reference the source title and date.
