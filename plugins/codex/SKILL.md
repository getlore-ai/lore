---
name: lore
description: Search and ingest knowledge from Lore — a research repository with citations and semantic search
---

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

Use `ingest` to push content into Lore when working context should be preserved, documents are shared, or you encounter important external content. Always pass `source_url` and `source_name` when available. Ingestion is idempotent.

## When to Search

Before making recommendations or answering questions about past work:
1. `search` first — it's fast and cheap
2. Only use `research` for multi-source synthesis (10x more expensive)
3. Use `get_source(id, include_content: true)` for full text

## When to Retain

Use `retain` for short synthesized knowledge (decisions, insights, requirements) — not full documents.
