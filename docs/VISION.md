# Lore - Vision & Requirements

## The Problem

When rapidly prototyping products and doing user research, knowledge gets fragmented across:

- **Granola** - User interviews, meeting notes with transcripts
- **Claude Code** - Development conversations, technical decisions
- **Claude Desktop** - Research, analysis, planning
- **ChatGPT** - Various conversations (though moving away from this)
- **Documents** - Competitor analysis, strategy docs, surveys

Each tool has its own siloed memory/context. There's no unified system where AI agents can:
1. Access the full corpus of project knowledge
2. Cite specific sources ("In the Jan 15 interview, Sarah said...")
3. Understand project lineage and decision history
4. Be delegated work with proper context

## Why Not Existing Solutions?

### Memory Systems (Basic Memory, Mem0, etc.)
These store **processed facts** without source material:
- "Users want faster exports" ❌ No citation possible
- Can't go back to the original interview
- Lossy compression of knowledge

### What We Need
A **research repository** that preserves sources:
- Full original content (transcripts, documents)
- Extracted insights **linked back** to sources
- Ability to cite: "At 12:34 in the Jan 15 interview, Sarah said '...'"
- Re-analyzable - can always extract new insights from originals

## Core Use Case

```
You: "Build a solution that addresses the feedback I received this week"

Agent workflow:
1. Query Lore: "user feedback last 7 days, project: data-pipeline"
2. Retrieve:
   - 3 user interviews from Granola (with specific quotes)
   - 2 retained insights from Claude Code sessions
   - 1 competitor analysis doc
3. Synthesize requirements FROM the evidence
4. Check lineage: "What have we already tried?"
5. Propose solution, citing sources
6. Prototype with full context
```

## Architecture Decision: Hybrid Approach

We evaluated three approaches:

### Approach A: Passive Tools + Smart Caller
- MCP exposes simple database queries
- Claude Code/Desktop does the reasoning
- **Pros**: Simpler, cheaper, transparent
- **Cons**: Many round-trips, quality depends on caller

### Approach B: Agentic Knowledge Vault
- MCP has internal agent (Claude Agent SDK)
- Single request → comprehensive research package
- **Pros**: Thorough, consistent quality
- **Cons**: Complex, expensive, less transparent

### Approach C: Hybrid (CHOSEN)
- **Simple tools** for direct queries (cheap, fast)
- **Agentic tool** for complex research (thorough)
- Caller chooses based on need
- Best of both worlds

## Three-Layer Knowledge Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    LAYER 1: SOURCE DOCUMENTS                │
│                        (immutable)                          │
├─────────────────────────────────────────────────────────────┤
│ • User interview transcripts (from Granola)                 │
│ • Meeting notes and recordings                              │
│ • AI conversation exports (Claude Code, Desktop)            │
│ • Documents (competitor analysis, strategy, surveys)        │
│ • Project notes and memos                                   │
│                                                             │
│ These are NEVER modified. Always preserved for citation.    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                 LAYER 2: EXTRACTED INSIGHTS                 │
│                  (linked to sources)                        │
├─────────────────────────────────────────────────────────────┤
│ Quotes                                                      │
│ • Specific statements with speaker attribution              │
│ • Timestamps for audio/video sources                        │
│ • Theme categorization                                      │
│ • Citation back to source document                          │
│                                                             │
│ Themes                                                      │
│ • pain-points, feature-requests, positive-feedback          │
│ • pricing, competition, workflow                            │
│ • decisions, requirements, insights                         │
│                                                             │
│ Decisions                                                   │
│ • What was decided and why                                  │
│ • Alternatives considered                                   │
│ • Citation to where decision was made                       │
│                                                             │
│ Requirements                                                │
│ • Derived from user evidence                                │
│ • Priority levels                                           │
│ • Source quotes as justification                            │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                  LAYER 3: WORKING CONTEXT                   │
│                    (for agents)                             │
├─────────────────────────────────────────────────────────────┤
│ • Project summaries (auto-generated)                        │
│ • Research packages (synthesized findings)                  │
│ • Delegation context (bundled for agent handoff)            │
│ • Lineage events (project history)                          │
└─────────────────────────────────────────────────────────────┘
```

## Source Ingestion Strategy

| Source | Strategy | Rationale |
|--------|----------|-----------|
| **Granola** | Pull (ingest all) | User interviews are always high-signal |
| **Claude Code** | Push (explicit ingest) | Many debugging sessions aren't worth keeping |
| **Claude Desktop** | Push (explicit ingest) | Mixed relevance |
| **ChatGPT** | Push (explicit ingest) | Moving away from this anyway |
| **Documents** | Pull (specific folders) | Point at project folders you care about |

The `ingest` MCP tool allows explicitly saving content from any context.

## MCP Tool Design

### Simple Tools (Passive, Fast, Cheap)

| Tool | Purpose |
|------|---------|
| `search` | Semantic search across sources, returns summaries + quotes |
| `get_source` | Full source document with all content |
| `list_sources` | Browse sources by project/type |
| `list_projects` | Project overview with stats |
| `ingest` | Add content — documents, insights, decisions |

### Agentic Tool (Active, Thorough, More Expensive)

| Tool | Purpose |
|------|---------|
| `research` | Multi-step research using Claude Agent SDK internally |

The `research` tool:
1. Searches across multiple sources
2. Cross-references findings
3. Synthesizes a research package
4. Includes citations for all claims
5. Identifies gaps and suggests follow-ups

## Project Organization

Projects are first-class citizens:
- All knowledge links to one or more projects
- Projects can have parent/child relationships (sub-projects)
- Lineage tracks key events (decisions, pivots, milestones)
- Stats show source count, quote count, latest activity

## Integration with granola-extractor

The existing `granola-extractor` repo:
- Continues to extract and process Granola meeting notes
- Becomes a **source adapter** for Lore
- Its exports can be ingested into Lore
- Could be refactored to write directly to Lore format

Options:
1. Keep separate: granola-extractor exports → Lore ingests
2. Merge: Move granola-extractor logic into Lore as an adapter
3. Shared library: Extract common code (embedder, vector store)

## Naming: Why "Lore"?

- **Meaning**: Accumulated knowledge, wisdom passed down
- **Fits the use case**: "What's the lore on this project?"
- **Short**: 4 letters, memorable
- **Branding potential**: "Build on Lore"
- **Works as verb-ish**: "Lore this insight"

## Non-Goals

- **Not a ChatGPT replacement** - Focus on Claude ecosystem
- **Not a note-taking app** - Sources come from other tools
- **Not a project management tool** - Just knowledge organization
- **Not a collaboration tool** - Single-user focus initially

## Success Criteria

1. Can ask "What did users say about X?" and get cited quotes
2. Can delegate work to agents with full project context
3. Can trace decisions back to their evidence
4. Single MCP server works from Claude Code and Claude Desktop
5. Granola interviews are fully searchable with speaker attribution
