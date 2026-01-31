# Lore - Planned Features

> Future features and enhancements for Lore. Organized into Core Platform (universal) and Extension Ecosystem (domain-specific).

## Overview

Lore's core value proposition: **"One knowledge foundation for all your AI tools."**

People use 3-5+ AI tools (Claude, ChatGPT, Cursor, Copilot, custom agents). Each starts from zero. Lore is the shared brain that gives them all access to the same knowledge with proper citations.

---

## Architecture Philosophy

```
┌─────────────────────────────────────────────────────────────┐
│                    EXTENSION ECOSYSTEM                       │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐            │
│  │  Research   │ │   Sales     │ │   Legal     │  ...       │
│  │  Toolkit    │ │   Toolkit   │ │   Toolkit   │            │
│  └─────────────┘ └─────────────┘ └─────────────┘            │
├─────────────────────────────────────────────────────────────┤
│                      CORE PLATFORM                           │
│  Import │ Graph │ Summaries │ Handoff │ Verify │ API        │
└─────────────────────────────────────────────────────────────┘
```

**Core Platform**: Universal features that benefit anyone using Lore. Built-in, always available.

**Extension Ecosystem**: Domain-specific features built on top of the core. Installed separately, enables specialized workflows without bloating the core.

---

## Priority Legend

- 🔴 **P0**: Critical for product-market fit
- 🟠 **P1**: High value, build soon after P0
- 🟡 **P2**: Important for growth/retention
- 🟢 **P3**: Nice to have, opportunistic

---

# Part 1: Core Platform

> Universal features that provide value to any Lore user regardless of domain.

---

## 1. Import & Ingestion

### 1.1 Universal Import Sources 🔴

Reduce friction to zero. People won't adopt if adding knowledge is hard.

| Source | Method | Priority |
|--------|--------|----------|
| Web pages | Browser extension / URL paste | 🔴 |
| PDFs | Drag & drop with OCR + vision | 🔴 |
| Markdown/Text | Direct file sync | ✅ Done |
| Notion | OAuth sync | 🟠 |
| Google Docs | OAuth sync | 🟠 |
| Email | Forward to lore@yourdomain.com | 🟠 |
| Slack/Discord | Bot integration | 🟡 |
| Voice memos | Whisper transcription | 🟡 |
| Screenshots | OCR + vision extraction | 🟡 |
| YouTube | Transcript extraction | 🟡 |
| Podcasts | Audio → text | 🟡 |
| Obsidian/Roam | Direct import | 🟠 |

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

actions:
  - trigger: "new source added"
    action: "webhook https://..."
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
- doc-v1.md
- doc-v2.md
- doc-final.md

→ Link as variants? [y/n]"
```

**Implementation notes:**
- Embedding similarity threshold (e.g., >0.92)
- UI to confirm/reject suggested links
- Store as `variant_of` relationship
- Query can return canonical or all variants

---

## 2. Knowledge Organization

### 2.1 Automatic Knowledge Graph 🔴

Documents aren't isolated. Automatically extract entities and relationships.

```
Source: "Meeting notes Jan 15"
  │
  ├─ Entities extracted:
  │   ├─ Person: "John Smith"
  │   ├─ Company: "Acme Corp"
  │   ├─ Product: "Widget Pro"
  │   └─ Concept: "enterprise pricing"
  │
  └─ Auto-linked to:
      ├─ 3 other sources mentioning "Acme Corp"
      └─ 2 sources about "enterprise pricing"
```

**Queries enabled:**
- "Everything related to Acme Corp"
- "All mentions of John Smith"
- "How is X connected to Y?"

**Implementation notes:**
- Entity extraction via LLM at ingest time
- Entity types: Person, Company, Product, Concept, Place, Event
- Store in graph structure (Supabase relations or dedicated graph DB)
- Entity resolution (merge "John" and "John Smith")
- Batch extraction for existing sources

### 2.2 Collections & Workspaces 🟠

Organize knowledge for different purposes without duplicating.

```
Workspace: "Project Alpha"
├─ Collection: "Research" (12 sources)
├─ Collection: "Specs" (5 sources)
└─ Collection: "Decisions" (3 sources)

Same source can appear in multiple collections.
```

**Implementation notes:**
- Many-to-many: sources ↔ collections
- Collections belong to workspaces
- Search can be scoped to collection/workspace
- Collections can have custom metadata/description

### 2.3 Tagging System 🟡

User-defined and auto-suggested tags.

```
Source: "Document X"
├─ User tags: #important, #review-needed
├─ Auto-suggested: #authentication, #api
└─ System tags: @document, @2024-01
```

**Implementation notes:**
- Manual tagging via CLI/API
- LLM suggests tags at ingest
- Tag hierarchy support
- Filter search by tags

---

## 3. Retrieval & Context

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
├─ Strongest evidence: Source X
│   └─ "I'd never commit to annual upfront"
├─ Confidence: MEDIUM (3 sources, similar context)
└─ Counter-evidence: None found
```

**Implementation notes:**
- Research agent already returns `supporting_quotes`
- Add explicit confidence scoring
- Surface contradicting evidence
- Include source diversity metrics

### 3.3 Confidence Scoring 🟠

Not all claims are equally supported.

```
Claim: "Feature X is important"
  ├─ Confidence: HIGH (7 mentions across 4 sources)
  ├─ Recency: Last mentioned Jan 28
  └─ Diversity: Multiple contexts
```

**Scoring factors:**
- Number of supporting sources
- Recency of sources
- Diversity of sources (different contexts)
- Explicitness (direct quote vs inference)

**Implementation notes:**
- Compute at query time by research agent
- Return as part of research response
- Consider: `research({ query: "...", require_confidence: "high" })`

### 3.4 Temporal Queries / Time Travel 🟡

"What did we know on Jan 15?"

```bash
lore search "topic" --as-of 2024-01-15
lore research "question" --as-of 2024-01-01
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

## 4. Intelligence & Insights

### 4.1 Contradiction Detection & Evolution 🟠

Automatically detect when new information contradicts old.

```
Topic: "Authentication approach"

Timeline:
Jan 10: "Approach A preferred" (3 mentions)
Jan 18: "Actually, Approach B better" (5 mentions)

⚠️ Conflict detected: Jan 10 vs Jan 18
Resolution: Later evidence from larger sample preferred
```

**Implementation notes:**
- Research agent already detects conflicts
- Enhance to produce visual timeline
- Store detected contradictions for future reference
- Alert when new source contradicts established knowledge

### 4.2 Freshness & Staleness Tracking 🟡

Knowledge gets stale. Surface this automatically.

```
Source Health:
├─ Fresh (< 30 days): 45 sources
├─ Aging (30-90 days): 23 sources
├─ Stale (> 90 days): 67 sources
└─ Potentially outdated: 12 sources

⚠️ Alert: "Competitor analysis" is 8 months old. Refresh?
```

**Implementation notes:**
- Track age of each source
- Configurable staleness thresholds
- Detect when newer source supersedes older
- Dashboard view (web UI or CLI)

---

## 5. Agent Collaboration

### 5.1 Cross-Session Agent Handoff 🔴

When one agent session ends and another begins, maintain continuity.

```typescript
// Agent A finishes work
lore.retain({
  type: "session_context",
  content: "Explored options. Key finding: X. Next: try Y.",
  session_id: "claude-code-abc123",
  handoff_to: ["any"]
});

// Agent B picks up
const context = lore.getSessionHandoff("claude-code");
// → "Previous session found X. Y was suggested as next step."
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
  query: "important topic",
  action: "notify",
  threshold: "high_relevance"
});

// After next sync...
// → "New source contains relevant content about 'important topic'"
```

**Implementation notes:**
- Store watch queries
- On new source, check against watches
- Notify via webhook, Slack, email
- Configurable relevance threshold

---

## 6. Collaboration & Sharing

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
lore share "package-name" --with user@email.com --expires 7d

# Export portable package
lore export --project "Project X" --format portable
# → project-x.lore

# Import
lore import project-x.lore --merge-strategy newest-wins
```

**Implementation notes:**
- Signed, encrypted export format
- Expiring share links
- Import with conflict resolution
- Selective export (filter by date, type, etc.)

### 6.3 Comments & Annotations 🟢

Add notes to sources without modifying them.

```
Source: "Document X"
├─ [Comment by Alice] "Key insight here"
├─ [Highlight] "Important quote..."
└─ [Question by Bob] "Should we follow up?"
```

**Implementation notes:**
- Annotations linked to source + position
- Collaborative (multiple users)
- Searchable
- Notifications on replies

---

## 7. Privacy & Security

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
├─ 2024-01-28 14:32 - alice searched "topic"
├─ 2024-01-28 14:33 - alice accessed source "doc-x"
├─ 2024-01-28 15:01 - bob ran research "question"
└─ 2024-01-28 15:02 - system synced 3 new sources
```

**Implementation notes:**
- Log all MCP tool calls
- Log authentication events
- Configurable retention
- Export for compliance

---

## 8. Developer Experience & Extensibility

### 8.1 REST/GraphQL API 🟠

Access beyond MCP for custom integrations.

```bash
# REST API
curl https://api.lore.dev/v1/search \
  -H "Authorization: Bearer $LORE_API_KEY" \
  -d '{"query": "search term"}'

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
  "title": "New document",
  "project": "my-project"
}
```

**Implementation notes:**
- Event types: source.*, research.*, sync.*
- Webhook management via CLI/API
- Retry logic for failed deliveries
- Signature verification

### 8.3 Extension System 🔴

Enable domain-specific features without bloating core.

```typescript
// Extension interface
interface LoreExtension {
  name: string;
  version: string;

  // New MCP tools
  tools?: ToolDefinition[];

  // New CLI commands
  commands?: CommandDefinition[];

  // Hooks into core events
  hooks?: {
    onSourceCreated?: (source: Source) => void;
    onResearchCompleted?: (result: ResearchResult) => void;
  };

  // Custom UI components (for web UI)
  components?: ComponentDefinition[];
}

// Install extension
lore extension install @lore/research-toolkit
lore extension install @lore/sales-toolkit
```

**Implementation notes:**
- npm packages with standard interface
- Extensions can add MCP tools, CLI commands, hooks
- Sandboxed execution
- Extension registry/marketplace
- Version compatibility checking

### 8.4 SDKs 🟡

Language-specific clients.

```python
# Python SDK
from lore import LoreClient

client = LoreClient(api_key="...")
results = client.search("query", project="my-project")
for source in results:
    print(f"{source.title}: {source.summary}")
```

**Implementation notes:**
- Python, TypeScript/Node, Go
- Typed interfaces
- Async support
- Published to PyPI, npm

---

## 9. Interfaces

### 9.1 Web UI 🟠

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

### 9.2 TUI (Terminal UI) 🟡

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

### 9.3 Browser Extension 🟠

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

### 9.4 Mobile App 🟢

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

## 10. Analytics

### 10.1 Usage Analytics 🟠

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

### 10.2 Knowledge Health Score 🟡

Overall assessment of knowledge base quality.

```
Knowledge Health: 72/100

✓ Good coverage: 156 sources across 5 projects
✓ Recent activity: 12 sources added this week
⚠ Staleness: 23% of sources over 90 days old
⚠ Gaps: Low coverage in some areas
✗ Low diversity: 80% of sources from same 2 origins
```

**Implementation notes:**
- Composite score from multiple factors
- Actionable recommendations
- Track over time

---

# Part 2: Extension Ecosystem

> Domain-specific features built on top of the Core Platform. Installed separately as extensions.

---

## Extension: Research Toolkit

For user research, interviews, and qualitative analysis.

### Speaker Profiles & Attribution

Build up profiles of who said what across all sources.

```
Speaker: "Sarah (Product Manager at Acme)"
  ├─ Appeared in: 3 sources
  ├─ Key themes: pricing, enterprise features
  ├─ Notable quotes:
  │   - "We need SSO for compliance"
  │   - "Budget is $X per seat"
  └─ Segment: Enterprise, decision-maker
```

**MCP tool:** `get_speaker_profile`

### Research Agenda / Question Bank

Track open questions. Alert when new sources might answer them.

```
Open Questions:
├─ "How do power users differ?" [HIGH priority]
│    └─ Last searched: Jan 20, no conclusive evidence
├─ "What's the willingness to pay?" [CRITICAL]
│    └─ Partially answered by 2 sources
└─ "Why do users churn?" [MEDIUM]
     └─ NEW MATCH: Source 'exit-interview' may answer this!
```

**MCP tools:** `add_question`, `list_questions`, `check_question_matches`

### Evidence Gap Analysis

Know what you *don't* know.

```
Coverage Report:

Well-evidenced:
✓ Core use case (12 sources)
✓ Pain points (8 sources)

Gaps identified:
✗ Pricing willingness (1 source, inconclusive)
✗ Enterprise needs (0 sources)

Suggested research:
- Add pricing questions to next 3 interviews
- Recruit enterprise users
```

**MCP tool:** `analyze_coverage`

### Hypothesis Testing

Structured way to validate assumptions.

```bash
lore hypothesis "Users will pay more for feature X"
```

**Output:**
```
Hypothesis: "Users will pay more for feature X"

SUPPORTING (4 sources):
- "That's the killer feature" - Source A
- "I'd upgrade for that" - Source B

CONTRADICTING (2 sources):
- "I don't need that" - Source C
- "The basic version is fine" - Source D

VERDICT: Mixed evidence. Segment difference identified.
```

**MCP tool:** `test_hypothesis`

---

## Extension: Decision Toolkit

For tracking decisions, their rationale, and outcomes.

### Evidence Chains & Decision Lineage

Track *why* decisions were made and *what evidence* supported them.

```
Decision: "Use approach A instead of B"
  ├─ Evidence: 3 sources supporting this
  ├─ Key quote: "B was too complex" - Source X
  ├─ Date: Jan 15, 2024
  └─ Outcome: [linked to future source showing result]
```

**MCP tools:** `record_decision`, `get_decision_lineage`, `link_outcome`

### Decision Templates

Structured decision records.

```yaml
decision:
  title: "Authentication approach"
  status: decided
  date: 2024-01-15
  options_considered:
    - OAuth (rejected: too complex)
    - Magic links (selected)
    - Passwords (rejected: security concerns)
  evidence:
    - source_id: abc123
      quote: "OAuth was confusing"
  outcome: pending
```

---

## Extension: Stakeholder Toolkit

For presenting knowledge to different audiences.

### Synthesis Templates

Same evidence, different audiences.

```bash
lore research "topic" --template investor-pitch
lore research "topic" --template product-spec
lore research "topic" --template executive-summary
```

**Templates:**
- `investor-pitch`: Market validation focus, metrics, quotes
- `product-spec`: Requirements, constraints, technical considerations
- `executive-summary`: High-level findings, recommendations
- `technical-deep-dive`: Implementation details, trade-offs

### Quote Collections / Evidence Boards

Curate quotes around a theme for presentations.

```bash
lore collection create "Key findings"
lore collection add quote_123 quote_456 quote_789

lore collection export "Key findings" --format slides
# → Generates presentation-ready slides with citations
```

**Export formats:** markdown, slides (reveal.js), PDF

---

## Extension: Sales Toolkit

For sales teams managing competitive intel and objection handling.

### Competitive Intelligence

Track and organize competitor information.

```
Competitor: "Acme Inc"
├─ Strengths: [from 5 sources]
├─ Weaknesses: [from 3 sources]
├─ Recent changes: [from 2 sources, last 30 days]
└─ Head-to-head mentions: 8 sources
```

### Objection Library

Common objections with evidence-based responses.

```
Objection: "Too expensive"
├─ Frequency: Mentioned in 12 sources
├─ Successful responses:
│   ├─ ROI calculation (worked 4 times)
│   └─ Comparison to alternatives (worked 3 times)
└─ Related sources: [links]
```

---

## Extension: Legal Toolkit

For legal teams tracking precedents and compliance.

### Precedent Tracking

Link current matters to historical precedents.

```
Matter: "Contract dispute X"
├─ Similar precedents: 3 found
├─ Key differences: [analysis]
└─ Relevant clauses: [extracted]
```

### Compliance Monitoring

Track regulatory requirements against evidence.

```
Requirement: "GDPR Article 17"
├─ Evidence of compliance: 4 sources
├─ Gaps: 1 area needs documentation
└─ Last reviewed: 30 days ago
```

---

## Extension: Content Toolkit

For content creators and writers.

### Source Bibliography

Auto-generate citations for content.

```bash
lore bibliography --project "Blog Post X" --format apa
lore bibliography --project "Blog Post X" --format chicago
```

### Fact Checking

Verify claims against knowledge base.

```bash
lore factcheck "Claim to verify"
# → Returns supporting/contradicting sources
```

---

## Creating Custom Extensions

### Extension Structure

```
my-extension/
├── package.json
├── src/
│   ├── index.ts        # Extension entry point
│   ├── tools/          # MCP tool definitions
│   ├── commands/       # CLI commands
│   └── hooks/          # Event hooks
└── README.md
```

### Example Extension

```typescript
// src/index.ts
import { LoreExtension } from '@lore/sdk';

export default {
  name: 'my-extension',
  version: '1.0.0',

  tools: [
    {
      name: 'my_custom_tool',
      description: 'Does something useful',
      parameters: { /* Zod schema */ },
      handler: async (params, lore) => {
        // Access core Lore functionality
        const results = await lore.search(params.query);
        // Custom processing
        return { /* result */ };
      }
    }
  ],

  hooks: {
    onSourceCreated: async (source, lore) => {
      // React to new sources
    }
  }
} satisfies LoreExtension;
```

### Publishing Extensions

```bash
# Build and publish
npm run build
npm publish --access public

# Users install
lore extension install my-extension
```

---

# Part 3: Implementation & Business

---

## Implementation Phases

### Phase A: Core Foundation

In priority order:

| # | Feature | Rationale |
|---|---------|-----------|
| 1 | 🔴 Extension system architecture | Foundation needed so features can be built as extensions |
| 2 | 🔴 PDF/Web import | Reduces adoption friction - people need to get data in |
| 3 | 🔴 Layered summaries | Core retrieval improvement, benefits all users immediately |
| 4 | 🔴 Agent handoff | Core value prop - multi-tool context sharing |
| 5 | 🔴 Verification mode | Trust/accuracy - builds on retrieval working well |
| 6 | 🔴 Knowledge graph (basic) | Most complex, builds on import working well |

### Phase B: Growth Features
- 🟠 Confidence scoring
- 🟠 Contradiction detection
- 🟠 REST API
- 🟠 Notion/Google Docs sync
- 🟠 Team workspaces
- 🟠 First-party extensions (Research, Decision toolkits)

### Phase C: Polish & Scale
- 🟡 Web UI
- 🟡 Temporal queries
- 🟡 Browser extension
- 🟡 Additional extensions

### Phase D: Expansion
- 🟢 Mobile app
- 🟢 Extension marketplace
- 🟢 Advanced analytics

---

## Pricing Model

| Tier | Price | Core Platform | Extensions |
|------|-------|---------------|------------|
| **Free** | $0 | 50 sources, 1 project, basic search | None |
| **Pro** | $15/mo | Unlimited sources, 5 projects, full features | 2 included |
| **Team** | $12/user/mo | Collaboration, shared workspaces | 5 included |
| **Enterprise** | Custom | Local deployment, SSO, audit logs | All included |

**Extension pricing:**
- First-party extensions: Included with paid tiers
- Third-party extensions: Set by developer (Lore takes 30%)

---

## Success Metrics

**Adoption:**
- Daily active users
- Sources ingested per user
- Queries per user per day

**Value:**
- Research sessions completed
- Extensions installed
- Net Promoter Score

**Engagement:**
- Retention (30-day, 90-day)
- Feature adoption rates
- Upgrade conversion (free → paid)

**Extension Ecosystem:**
- Number of published extensions
- Extension installs
- Developer satisfaction

---

## Competitive Landscape

| Competitor | Strength | Lore Differentiation |
|------------|----------|---------------------|
| Notion AI | Integrated workspace | Citation-native, multi-tool, extensible |
| Mem.ai | AI-first notes | Source preservation, extensions |
| Obsidian + plugins | Local, customizable | Agentic research, cross-tool sync |
| Rewind.ai | Automatic capture | Structured knowledge, not recordings |
| Custom RAG | Flexible | Turnkey, citations, collaboration |

**Lore's moat:**
1. **MCP-first**: Native support for AI tool ecosystem
2. **Citation-native**: Every insight traces to source
3. **Agentic research**: Not just retrieval, but synthesis
4. **Multi-tool sync**: Works across Claude, ChatGPT, Cursor, etc.
5. **Extension ecosystem**: Domain-specific without bloating core
