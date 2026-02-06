# Lore Knowledge Base

Lore is a research knowledge repository available via MCP. It stores documents, meeting notes, interviews, and decisions with full citations back to original sources. Use it to ground your work in evidence and preserve important context.

## MCP Tools

| Tool | Cost | Use For |
|------|------|---------|
| `search` | Low | Quick lookups, finding relevant sources |
| `get_source` | Low | Full document retrieval by ID |
| `list_sources` | Low | Browse what exists in a project |
| `list_projects` | Low | Discover available knowledge domains |
| `retain` | Low | Save discrete insights/decisions |
| `ingest` | Medium | Push full documents into the knowledge base |
| `research` | High | Cross-reference multiple sources, synthesize findings |
| `sync` | Variable | Refresh from configured source directories |

## When to Ingest

Use `ingest` to push content into Lore when:
- Working context should be preserved for future sessions
- Documents, specs, or research are shared that the team needs to reference later
- You encounter important external content (from integrations, web, etc.)

Always pass `source_url` (original URL for linking) and `source_name` (human-readable label like "GitHub PR #123") when available. Ingestion is idempotent — safe to call repeatedly with the same content.

## When to Search

Before making recommendations or answering questions about past work:
1. `search` first — it's fast and cheap
2. Only use `research` if the question genuinely needs cross-referencing multiple sources
3. Use `get_source(id, include_content: true)` when you need the full text

## When to Retain

Use `retain` for short synthesized knowledge (not full documents):
- Decisions made during a session
- Key insights distilled from analysis
- Requirements extracted from conversations

## Example: Grounding a Decision

```
# 1. Check what exists
search("database migration approach", project: "backend-rewrite")

# 2. If results are relevant, get full context
get_source("abc-123", include_content: true)

# 3. After making a decision, retain it
retain(
  content: "Chose pgvector over Pinecone for embeddings — lower latency, simpler ops, sufficient scale",
  project: "backend-rewrite",
  type: "decision",
  source_context: "Architecture review session"
)
```
