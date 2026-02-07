# Lore Knowledge Base — Agent Instructions

Lore is a research knowledge repository accessible via MCP (Model Context Protocol). It stores documents with full-text search, semantic search, and citation tracking. Content is deduplicated, embedded for retrieval, and organized by project.

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

## Core Concepts

- **Sources**: Full documents (meeting notes, interviews, Slack threads, specs, etc.)
- **Projects**: Organizational grouping for sources
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

For short insights, decisions, or notes — title and source_type are optional:
```json
{
  "content": "We chose JWT over session cookies because of mobile app requirements",
  "project": "auth-system"
}
```

- **Idempotent**: Duplicate content returns `{deduplicated: true}` with no processing cost.
- **source_type**: Free-form string. Common values: `meeting`, `interview`, `document`, `notes`, `analysis`, `conversation`, `slack`, `email`, `github-issue`, `notion`.
- **source_url**: Always pass when available — enables citation linking.
- **source_name**: Human-readable origin label.
- Short content (≤500 chars) skips LLM extraction for speed.

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

### `research` — Deep research with citations
Runs an internal agent that iteratively searches, reads, and synthesizes findings.

```json
{
  "task": "What authentication approach should we use based on user feedback?",
  "project": "my-project"
}
```

**Async**: Returns a `job_id` immediately. Poll `research_status` for results (typically 2-8 minutes). Makes 10-30 internal LLM calls. Use `search` for simple lookups.

### `sync` — Refresh from source directories
Scans configured directories for new files. Use `ingest` for agent-pushed content instead.

### `archive_project` — Archive a project
Excludes from default search. Only use when explicitly requested.

## Best Practices

1. **Search before you answer**: If a question might have documented context, search Lore first.
2. **Ingest what matters**: After meaningful conversations or when processing external content, ingest it.
3. **Always pass source_url**: Enables citation linking back to the original.
4. **Ingest handles both long and short content**: For short insights, decisions, or notes — just pass the content. Title and source_type are optional.
5. **Prefer search over research**: `search` is 10x cheaper. Only use `research` for multi-source synthesis.
6. **Cite your sources**: When presenting Lore results, reference the source title and date.
