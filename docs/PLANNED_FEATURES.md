# Lore - Planned Features

> Future features and enhancements for Lore. Organized by category with implementation notes.

## Overview

Lore's core value proposition: **"One knowledge foundation for all your AI tools."**

People use 3-5+ AI tools (Claude, ChatGPT, Cursor, Copilot, custom agents). Each starts from zero. Lore is the shared brain that gives them all access to the same knowledge with proper citations.

---

## Priority Legend

- 🔴 **P0**: Critical for product-market fit
- 🟠 **P1**: High value, build soon after P0
- 🟡 **P2**: Important for growth/retention
- 🟢 **P3**: Nice to have, opportunistic

---

## Category 1: Import & Ingestion

### 1.1 Universal Import Sources 🔴

Reduce friction to zero. People won't adopt if adding knowledge is hard.

| Source | Method | Priority |
|--------|--------|----------|
| Web pages | Browser extension / URL paste | 🔴 |
| PDFs | Drag & drop with OCR + vision | 🔴 |
| Notion | OAuth sync | 🟠 |
| Google Docs | OAuth sync | 🟠 |
| Email | Forward to lore@yourdomain.com | 🟠 |
| Slack/Discord | Bot integration | 🟡 |
| Voice memos | Whisper transcription | 🟡 |
| Screenshots | OCR + vision extraction | 🟡 |
| YouTube | Transcript extraction | 🟡 |
| Podcasts | Audio → text | 🟡 |
| Obsidian/Roam | Direct import | 🟠 |
| Readwise | API sync | 🟡 |
| Twitter/X bookmarks | API sync | 🟢 |
| Kindle highlights | Import file | 🟢 |

**Implementation notes:**
- Browser extension for web capture (manifest v3)
- OAuth flows for cloud services
- Webhook endpoint for email forwarding
- Whisper API for audio transcription
- Consider using existing tools like Firecrawl for web scraping

### 1.2 Scheduled Sync & Automation 🟠

Set it and forget it. Knowledge stays fresh without manual effort.

```yaml
# .lore/automations.yml
sync:
  - source: notion
    schedule: "every 6 hours"
  - source: google-drive/Research
    schedule: "daily at 2am"
  - source: email-label/Important
    schedule: "every 30 minutes"

actions:
  - trigger: "new source matches 'urgent'"
    action: "notify slack #research"
```

**Implementation notes:**
- Cron-style scheduling
- Webhook notifications for events
- Rate limiting and error handling
- Status dashboard for sync health

### 1.3 Semantic Deduplication 🟡

Detect near-duplicates, not just exact hash matches.

```
"These 3 sources appear to be variants of the same content:
- interview-jan15-raw.md (transcript)
- interview-jan15-notes.md (your notes)
- interview-jan15-summary.md (AI summary)

→ Link as variants? [y/n]"
```

**Implementation notes:**
- Embedding similarity threshold (e.g., >0.92)
- UI to confirm/reject suggested links
- Store as `variant_of` relationship
- Query can return canonical or all variants

---

## Category 2: Knowledge Organization

### 2.1 Automatic Knowledge Graph 🔴

Documents aren't isolated. Automatically extract entities and relationships.

```
Source: "Meeting with Acme Corp"
  │
  ├─ Entities extracted:
  │   ├─ Person: "John Smith" (CTO)
  │   ├─ Company: "Acme Corp"
  │   ├─ Product: "Widget Pro"
  │   └─ Concept: "enterprise pricing"
  │
  └─ Auto-linked to:
      ├─ 3 other sources mentioning "Acme Corp"
      ├─ 2 sources about "enterprise pricing"
      └─ Email thread with "John Smith"
```

**Queries enabled:**
- "Everything related to Acme Corp"
- "All mentions of John Smith"
- "How is X connected to Y?"

**Implementation notes:**
- Entity extraction via LLM at ingest time
- Entity types: Person, Company, Product, Concept, Place, Event
- Store in graph structure (could use Supabase relations or dedicated graph DB)
- Entity resolution (merge "John" and "John Smith")
- Batch extraction for existing sources

### 2.2 Collections & Workspaces 🟠

Organize knowledge for different purposes without duplicating.

```
Workspace: "Product Launch"
├─ Collection: "Customer Feedback" (12 sources)
├─ Collection: "Competitive Intel" (8 sources)
├─ Collection: "Technical Specs" (5 sources)
└─ Collection: "Marketing Assets" (3 sources)

Same source can appear in multiple collections.
```

**Implementation notes:**
- Many-to-many: sources ↔ collections
- Collections belong to workspaces
- Search can be scoped to collection/workspace
- Collections can have custom metadata/description

### 2.3 Speaker Profiles & Attribution 🟡

Build up profiles of who said what across all sources.

```
Speaker: "Sarah (Product Manager at Acme)"
  ├─ Appeared in: 3 sources
  ├─ Key themes: pricing concerns, enterprise features
  ├─ Notable quotes:
  │   - "We need SSO for compliance"
  │   - "Budget is $X per seat"
  └─ Segment: Enterprise, decision-maker
```

**Implementation notes:**
- Extract speaker names at ingest (already in schema)
- Entity resolution for same person across sources
- Aggregate quotes by speaker
- MCP tool: `get_speaker_profile`

### 2.4 Tagging System 🟡

User-defined and auto-suggested tags.

```
Source: "Interview Jan 15"
├─ User tags: #enterprise, #pricing
├─ Auto-suggested: #authentication, #compliance
└─ System tags: @interview, @2024-01
```

**Implementation notes:**
- Manual tagging via CLI/API
- LLM suggests tags at ingest
- Tag hierarchy support
- Filter search by tags

---

## Category 3: Retrieval & Context

### 3.1 Layered Summaries (Zoom In/Out) 🔴

Same knowledge, different granularity. AI agents often need just enough context.

```
Level 0: One-liner
"Q4 planning meeting - decided to focus on enterprise"

Level 1: Key points (5 bullets)
- Focus on enterprise segment
- Hire 2 salespeople
- Delay consumer launch
- Budget: $X
- Timeline: Q1

Level 2: Detailed summary (paragraph)
[Full context with decisions, rationale, action items]

Level 3: Full source
[Complete transcript/document]
```

**MCP tool enhancement:**
```typescript
search({ query: "...", detail_level: 1 })  // Returns bullet summaries
get_source({ id: "...", detail_level: 2 }) // Returns paragraph summary
```

**Implementation notes:**
- Generate all levels at ingest time
- Store as `summary_l0`, `summary_l1`, `summary_l2`
- Reduces token usage for AI consumers
- User can request specific level

### 3.2 Verification Mode / Source Highlighting 🔴

When AI makes claims, show exactly what it's based on.

```
AI: "Users prefer monthly billing over annual."

[Verification]
├─ Based on: 3 sources
├─ Strongest evidence: "Interview with User 7"
│   └─ "I'd never commit to annual upfront"
├─ Confidence: MEDIUM (3 sources, same user segment)
└─ Counter-evidence: None found
```

**Implementation notes:**
- Research agent already returns `supporting_quotes`
- Add explicit confidence scoring
- Surface contradicting evidence
- Include source diversity metrics

### 3.3 Confidence Scoring & Evidence Strength 🟠

Not all claims are equally supported.

```
"Users want faster exports"
  ├─ Confidence: HIGH (7 mentions across 4 sources)
  ├─ Recency: Last mentioned Jan 28
  └─ Diversity: 3 paying customers, 1 churned user
```

**Scoring factors:**
- Number of supporting sources
- Recency of sources
- Diversity of sources (different people, contexts)
- Explicitness (direct quote vs inference)

**Implementation notes:**
- Compute at query time by research agent
- Return as part of research response
- Consider: `research({ query: "...", require_confidence: "high" })`

### 3.4 Temporal Queries / Time Travel 🟡

"What did we know on Jan 15?"

```bash
lore search "user needs" --as-of 2024-01-15
lore research "product strategy" --as-of 2024-01-01
```

**Use cases:**
- Retrospectives: "At the time of that decision, this is what we knew"
- Understanding evolution: "How has our view changed?"
- Debugging: "What information was available then?"

**Implementation notes:**
- Filter by `created_at` or `imported_at`
- Research agent respects time boundary
- Useful for post-mortems

---

## Category 4: Intelligence & Insights

### 4.1 Contradiction Detection & Evolution Timeline 🟠

Automatically detect when new information contradicts old.

```
Topic: "Authentication preferences"

Timeline:
Jan 10: "Users want social login" (3 mentions)
Jan 18: "Actually, email magic links preferred" (5 mentions)
Jan 25: "Enterprise users need SSO" (new segment identified)

⚠️ Conflict detected: Jan 10 vs Jan 18
Resolution: Later evidence (Jan 18) from larger sample preferred
```

**Implementation notes:**
- Research agent already detects conflicts
- Enhance to produce visual timeline
- Store detected contradictions for future reference
- Alert when new source contradicts established knowledge

### 4.2 Evidence Gap Analysis 🟠

Know what you *don't* know.

```
Coverage Report for "Project X":

Well-evidenced:
✓ Core use case (12 sources)
✓ Pain points (8 sources)
✓ Feature requests (15 sources)

Gaps identified:
✗ Pricing willingness (1 source, inconclusive)
✗ Enterprise needs (0 sources)
✗ Competitor comparison (2 sources, outdated)

Suggested research:
- Add pricing questions to next 3 interviews
- Recruit 2 enterprise users for interviews
```

**Implementation notes:**
- Define topic taxonomy or use dynamic topics
- Count sources per topic
- Compare against expected coverage
- MCP tool: `analyze_coverage`

### 4.3 Cross-Project Pattern Detection 🟡

Find universal truths across your work.

```
Cross-Project Insight:
"Users in 3 different projects mentioned frustration with onboarding"
  ├─ Project A (note-taking app): "Too many steps to start"
  ├─ Project B (analytics tool): "Couldn't figure out where to begin"
  └─ Project C (this project): "The setup wizard was confusing"

→ Meta-learning: Onboarding simplicity is a universal pain point
```

**Implementation notes:**
- Run research across all projects
- Cluster similar themes
- Surface patterns that appear in 2+ projects
- MCP tool: `find_patterns`

### 4.4 Hypothesis Testing Mode 🟡

Structured way to validate assumptions.

```bash
lore hypothesis "Users will pay more for AI features"
```

**Output:**
```
Hypothesis: "Users will pay more for AI features"

SUPPORTING (4 sources):
- "The AI suggestions are why I'd upgrade" - User 7
- "That's the killer feature" - User 12

CONTRADICTING (2 sources):
- "I don't trust AI with my data" - User 3
- "The manual mode is what I use" - User 9

VERDICT: Mixed evidence. Segment identified: technical users
skeptical, non-technical users enthusiastic.
```

**Implementation notes:**
- Variant of research that explicitly seeks both sides
- Structured output with SUPPORTING/CONTRADICTING
- Suggests refined hypothesis or segments

### 4.5 Research Agenda / Question Bank 🟡

Track open questions. Alert when new sources might answer them.

```
Open Questions:
├─ "How do power users differ from casual users?" [HIGH priority]
│    └─ Last searched: Jan 20, no conclusive evidence
├─ "What's the willingness to pay?" [CRITICAL]
│    └─ Partially answered by 2 sources
└─ "Why do users churn?" [MEDIUM]
     └─ NEW MATCH: Source 'exit-interview-jan28' may answer this!
```

**Implementation notes:**
- Store questions with priority
- On new source ingestion, check against open questions
- Notify when potential match found
- Track answer status: unanswered / partial / answered

### 4.6 Freshness & Decay Tracking 🟡

Knowledge gets stale. Surface this automatically.

```
Source Health Dashboard:
├─ Fresh (< 30 days): 45 sources
├─ Aging (30-90 days): 23 sources
├─ Stale (> 90 days): 67 sources
└─ Potentially outdated: 12 sources
    └─ "Pricing doc" - newer source may supersede

⚠️ Alert: "Competitor analysis" is 8 months old. Refresh?
```

**Implementation notes:**
- Track age of each source
- Configurable staleness thresholds
- Detect when newer source supersedes older
- Dashboard view (web UI or CLI)

---

## Category 5: Agent Collaboration

### 5.1 Cross-Session Agent Handoff 🔴

When one agent session ends and another begins, maintain continuity.

```typescript
// Agent A finishes work
lore.retain({
  type: "session_context",
  content: "Explored auth options. Key finding: users hate OAuth. Next: test magic links.",
  session_id: "claude-code-abc123",
  handoff_to: ["any"]
});

// Agent B picks up
const context = lore.getSessionHandoff("claude-code");
// → "Previous session found users hate OAuth. Magic links were suggested."
```

**MCP tools:**
- `retain` with `type: session_context`
- `get_session_context` - retrieve recent session summaries

**Implementation notes:**
- Auto-summarize session before ending (hook?)
- Store with session metadata
- Retrieve recent sessions for same user/project
- Configurable handoff scope

### 5.2 Active Monitoring / Smart Alerts 🟠

"When X happens, tell me."

```typescript
lore.watch({
  query: "pricing feedback",
  action: "notify",
  threshold: "high_relevance"
});

// After next sync...
// → "New source 'user-interview-jan29' contains 3 mentions of pricing.
//    Key quote: 'I'd pay up to $30/month for this'"
```

**Implementation notes:**
- Store watch queries
- On new source, check against watches
- Notify via webhook, Slack, email
- Configurable relevance threshold

### 5.3 Evidence Chains & Decision Lineage 🟠

Track *why* decisions were made and *what evidence* supported them.

```
Decision: "Use magic link auth instead of OAuth"
  ├─ Evidence: 3 user interviews mentioning OAuth confusion
  ├─ Quote: "I gave up after the third redirect" - Sarah, Jan 15
  └─ Outcome: [linked to future source showing if it worked]
```

**Implementation notes:**
- Add `decision` type to retain with `evidence_ids[]`
- Link decisions to supporting sources
- Research agent can trace lineage
- Useful for retrospectives and stakeholder communication

### 5.4 Stakeholder Views / Synthesis Templates 🟡

Same evidence, different audiences.

```bash
lore research "What have we learned about pricing?" --format investor-pitch
lore research "What have we learned about pricing?" --format product-spec
lore research "What have we learned about pricing?" --format raw-evidence
```

**Investor pitch output:**
> "Market research with 15 users revealed price sensitivity peaks at $X/mo..."

**Product spec output:**
> "Pricing constraints: must support monthly/annual, users expect free tier..."

**Implementation notes:**
- Template system for research output
- Pre-defined templates: investor, product, technical, executive
- Custom templates via config
- Same underlying evidence, different framing

### 5.5 Quote Collections / Evidence Boards 🟡

Curate quotes around a theme for presentations.

```bash
lore collection create "Why users love us"
lore collection add quote_123 quote_456 quote_789

lore collection export "Why users love us" --format slides
# → Generates presentation-ready quote slides with citations
```

**Implementation notes:**
- Collections of quotes (not just sources)
- Export formats: markdown, slides, PDF
- Include citations automatically
- Shareable links

---

## Category 6: Collaboration & Sharing

### 6.1 Team Knowledge Bases 🟠

Shared workspaces with access control.

```
Team Workspace: "Engineering"
├─ Members: 5 people
├─ Shared sources: 234
├─ Private sources: Each member has own
└─ Permissions:
    ├─ Alice: Admin
    ├─ Bob: Can add, can't delete
    └─ Carol: Read-only
```

**Implementation notes:**
- User accounts and authentication
- Workspace membership
- Role-based access control
- Audit log of changes

### 6.2 Sharing & Export 🟠

Share knowledge packages with collaborators.

```bash
# Share temporarily
lore share "research-package-jan" --with bob@team.com --expires 7d

# Export portable package
lore export --project "Project X" --format portable
# → project-x-knowledge.lore

# Import
lore import project-x-knowledge.lore --merge-strategy newest-wins
```

**Implementation notes:**
- Signed, encrypted export format
- Expiring share links
- Import with conflict resolution
- Selective export (filter by date, type, etc.)

### 6.3 Comments & Annotations 🟢

Add notes to sources without modifying them.

```
Source: "Interview Jan 15"
├─ [Comment by Alice] "Key insight here about pricing"
├─ [Highlight] "Users mentioned..."
└─ [Question by Bob] "Should we follow up on this?"
```

**Implementation notes:**
- Annotations linked to source + position
- Collaborative (multiple users)
- Searchable
- Notifications on replies

---

## Category 7: Privacy & Security

### 7.1 Local-First Option 🟠

For sensitive knowledge, offer fully local deployment.

```
Deployment options:
├─ Cloud (default): Supabase, easy setup
├─ Hybrid: Embeddings in cloud, content local
└─ Fully local: SQLite + local embeddings, air-gapped
```

**Implementation notes:**
- SQLite for local vector store (with sqlite-vss)
- Local embedding model option (e.g., all-MiniLM-L6-v2)
- No network calls in air-gapped mode
- Same MCP interface regardless of deployment

### 7.2 Encryption at Rest 🟡

Encrypt sensitive content.

```bash
lore config set encryption.enabled true
lore config set encryption.key-source keychain  # or: file, env
```

**Implementation notes:**
- AES-256 encryption for content
- Key management options
- Encrypted in Supabase, decrypted locally
- Per-source encryption option

### 7.3 Audit Logging 🟡

Track all access for compliance.

```
Audit Log:
├─ 2024-01-28 14:32 - alice searched "customer data"
├─ 2024-01-28 14:33 - alice accessed source "interview-jan15"
├─ 2024-01-28 15:01 - bob ran research "pricing strategy"
└─ 2024-01-28 15:02 - system synced 3 new sources
```

**Implementation notes:**
- Log all MCP tool calls
- Log authentication events
- Configurable retention
- Export for compliance

---

## Category 8: Developer Experience

### 8.1 REST/GraphQL API 🟠

Access beyond MCP for custom integrations.

```bash
# REST API
curl https://api.lore.dev/v1/search \
  -H "Authorization: Bearer $LORE_API_KEY" \
  -d '{"query": "customer feedback on pricing"}'

# Response includes source_ids, quotes, confidence
```

**Implementation notes:**
- REST endpoints mirroring MCP tools
- GraphQL for flexible queries
- API key authentication
- Rate limiting
- OpenAPI spec

### 8.2 Webhooks & Events 🟠

React to Lore events.

```bash
# Configure webhook
lore webhook add https://your-app.com/lore-events \
  --events source.created,research.completed

# Payload example
{
  "event": "source.created",
  "source_id": "abc123",
  "title": "New interview transcript",
  "project": "my-project"
}
```

**Implementation notes:**
- Event types: source.*, research.*, sync.*
- Webhook management via CLI/API
- Retry logic for failed deliveries
- Signature verification

### 8.3 SDKs 🟡

Language-specific clients.

```python
# Python SDK
from lore import LoreClient

client = LoreClient(api_key="...")
results = client.search("user feedback", project="my-project")
for source in results:
    print(f"{source.title}: {source.summary}")
```

**Implementation notes:**
- Python, TypeScript/Node, Go
- Typed interfaces
- Async support
- Published to PyPI, npm

### 8.4 Plugin System 🟢

Custom source adapters and processors.

```typescript
// Custom adapter
lore.registerAdapter("jira", {
  sync: async (config) => { /* fetch from Jira API */ },
  transform: (issue) => ({ title: issue.summary, ... })
});
```

**Implementation notes:**
- Adapter interface definition
- Plugin discovery (npm packages?)
- Configuration schema per plugin
- Marketplace/registry

---

## Category 9: Analytics & Insights

### 9.1 Usage Analytics 🟠

Know if Lore is providing value.

```
This month:
├─ 145 queries from AI tools
├─ 23 sources added
├─ Most accessed: "Product roadmap" (34 times)
├─ Never accessed: 12 sources (consider archiving?)
└─ Research sessions: 8

Top queries:
1. "pricing strategy" (12 times)
2. "customer feedback" (9 times)
3. "competitor features" (7 times)
```

**Implementation notes:**
- Track all queries and accesses
- Dashboard view
- Export for analysis
- Privacy-preserving (aggregate, not individual)

### 9.2 Knowledge Health Score 🟡

Overall assessment of knowledge base quality.

```
Knowledge Health: 72/100

✓ Good coverage: 156 sources across 5 projects
✓ Recent activity: 12 sources added this week
⚠ Staleness: 23% of sources over 90 days old
⚠ Gaps: No sources about "enterprise requirements"
✗ Low diversity: 80% of sources from same 2 people
```

**Implementation notes:**
- Composite score from multiple factors
- Actionable recommendations
- Track over time

---

## Category 10: Interfaces

### 10.1 Web UI 🟠

Browse and manage knowledge visually.

**Features:**
- Search with filters
- Source viewer with highlights
- Knowledge graph visualization
- Collection management
- Settings and configuration
- Analytics dashboard

**Implementation notes:**
- React/Next.js or similar
- Connect via API
- Optional (Lore works without it)
- Self-hostable

### 10.2 TUI (Terminal UI) 🟡

Enhanced terminal interface for power users.

```bash
lore tui
# → Opens interactive terminal UI with:
#   - Search bar
#   - Source list with preview
#   - Quick actions
#   - Keyboard navigation
```

**Implementation notes:**
- Ink (React for CLI) or Blessed
- Vim-style keybindings
- Fast navigation
- Inline previews

### 10.3 Browser Extension 🟠

Capture web content easily.

**Features:**
- Save current page to Lore
- Highlight and save selections
- Quick search Lore from any page
- Auto-detect relevant content

**Implementation notes:**
- Chrome/Firefox extension
- Manifest v3
- Connect to local Lore or cloud API
- Context menu integration

### 10.4 Mobile App 🟢

Access knowledge on the go.

**Features:**
- Search
- Voice memo capture
- Photo/document scanning
- Push notifications for alerts

**Implementation notes:**
- React Native or Flutter
- Offline-capable
- Sync when connected

---

## Pricing Model (For Commercial Offering)

| Tier | Price | Features |
|------|-------|----------|
| **Free** | $0 | 50 sources, 1 project, basic search, MCP access |
| **Pro** | $15/mo | Unlimited sources, 5 projects, agentic research, imports |
| **Team** | $12/user/mo | Collaboration, shared workspaces, admin controls |
| **Enterprise** | Custom | Local deployment, SSO, audit logs, SLA, support |

---

## Implementation Phases

### Phase A: Core Product (Months 1-2)
- 🔴 Layered summaries
- 🔴 Verification mode
- 🔴 Knowledge graph (basic)
- 🔴 Agent handoff
- 🔴 PDF/Web import

### Phase B: Growth Features (Months 3-4)
- 🟠 Confidence scoring
- 🟠 Contradiction detection
- 🟠 Evidence gap analysis
- 🟠 REST API
- 🟠 Notion/Google Docs sync
- 🟠 Team workspaces

### Phase C: Polish & Scale (Months 5-6)
- 🟡 Web UI
- 🟡 Temporal queries
- 🟡 Speaker profiles
- 🟡 Hypothesis testing
- 🟡 Research templates

### Phase D: Expansion (Months 7+)
- 🟢 Mobile app
- 🟢 Plugin system
- 🟢 Advanced analytics
- 🟢 Browser extension

---

## Success Metrics

**Adoption:**
- Daily active users
- Sources ingested per user
- Queries per user per day

**Value:**
- Research sessions completed
- Time saved (self-reported)
- Net Promoter Score

**Engagement:**
- Retention (30-day, 90-day)
- Feature adoption rates
- Upgrade conversion (free → paid)

---

## Competitive Landscape

| Competitor | Strength | Lore Differentiation |
|------------|----------|---------------------|
| Notion AI | Integrated workspace | Citation-native, multi-tool |
| Mem.ai | AI-first notes | Source preservation, not just memory |
| Obsidian + plugins | Local, customizable | Agentic research, cross-tool sync |
| Rewind.ai | Automatic capture | Structured knowledge, not recordings |
| Custom RAG | Flexible | Turnkey, citations, collaboration |

**Lore's moat:**
1. MCP-first: Native support for AI tool ecosystem
2. Citation-native: Every insight traces to source
3. Agentic research: Not just retrieval, but synthesis
4. Multi-tool sync: Works across Claude, ChatGPT, Cursor, etc.
