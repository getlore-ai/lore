# Lore - Data Model

## Core Principle: Provenance

Every piece of knowledge in Lore can be traced back to its source. This is the key differentiator from "memory" systems.

```
Quote: "The export takes too long"
  └── Citation
        ├── source_id: "interview-sarah-jan15"
        ├── location: "12:34"
        └── context: "Discussing daily workflow"
              └── SourceDocument
                    ├── title: "User Interview - Sarah"
                    ├── source_type: "granola"
                    ├── content: [full transcript]
                    └── created_at: "2024-01-15"
```

## Source Documents

The immutable original content.

```typescript
interface SourceDocument {
  id: string;                    // UUID

  // Origin tracking
  source_type: SourceType;       // 'granola' | 'claude-code' | 'markdown' | ...
  source_id: string;             // Original ID in source system
  source_path?: string;          // Path to original file

  // Content
  title: string;
  content: string;               // Full original content
  content_type: ContentType;     // 'interview' | 'meeting' | 'conversation' | ...

  // Metadata
  created_at: string;            // When the source was created
  imported_at: string;           // When added to Lore
  participants?: string[];       // People involved

  // Organization
  projects: string[];            // Project IDs
  tags: string[];                // User-defined tags
}
```

### Source Types

| Type | Description | Example Sources |
|------|-------------|-----------------|
| `granola` | Meeting transcripts from Granola app | User interviews, team meetings |
| `claude-code` | Claude Code conversation exports | Development sessions, debugging |
| `claude-desktop` | Claude Desktop exports | Research, analysis |
| `chatgpt` | ChatGPT exports | Legacy conversations |
| `markdown` | Markdown documents | Notes, docs, analysis |
| `document` | Other documents | PDFs, etc. |

### Content Types

| Type | Description |
|------|-------------|
| `interview` | User interview or research call |
| `meeting` | General meeting |
| `conversation` | AI conversation |
| `document` | Written document |
| `note` | Quick note or memo |
| `analysis` | Research synthesis, competitor analysis |

## Citations

The link between insights and sources.

```typescript
interface Citation {
  source_id: string;             // Reference to SourceDocument
  location?: string;             // Timestamp, line number, section
  context?: string;              // Surrounding text for context
}
```

Citations enable:
- Direct navigation to source
- Context preservation
- Verification of claims

## Quotes

The atomic unit of evidence.

```typescript
interface Quote {
  id: string;
  text: string;                  // The actual quote
  speaker?: 'user' | 'participant' | 'ai' | 'unknown';
  speaker_name?: string;         // "Sarah", "John"
  timestamp?: string;            // "12:34" for audio/video
  theme?: ThemeName;             // Categorization
  citation: Citation;            // Link back to source
}
```

Speaker attribution is critical for user research:
- `user` = You (the interviewer/host)
- `participant` = The interviewee/guest
- `ai` = AI assistant in conversation
- `unknown` = Can't determine

## Themes

Categorization of insights.

```typescript
type ThemeName =
  | 'pain-points'       // User frustrations
  | 'feature-requests'  // Desired features
  | 'positive-feedback' // What users liked
  | 'pricing'           // Cost concerns
  | 'competition'       // Competitor mentions
  | 'workflow'          // How users work
  | 'decisions'         // Key decisions
  | 'requirements'      // Product requirements
  | 'insights';         // General insights

interface Theme {
  name: ThemeName;
  evidence: Quote[];             // Supporting quotes
  summary?: string;              // LLM-generated summary
}
```

## Decisions

Explicit decisions with rationale.

```typescript
interface Decision {
  id: string;
  decision: string;              // What was decided
  rationale: string;             // Why
  alternatives_considered?: string[];
  made_at: string;               // When
  citation: Citation;            // Where this was decided
  project_id: string;
}
```

## Requirements

Product/technical requirements derived from evidence.

```typescript
interface Requirement {
  id: string;
  description: string;
  priority: 'must' | 'should' | 'could' | 'wont';
  source_quotes: Quote[];        // Evidence
  project_id: string;
}
```

## Projects

Organizing container for knowledge.

```typescript
interface Project {
  id: string;
  name: string;
  description: string;
  status: 'active' | 'paused' | 'completed' | 'archived';
  created_at: string;
  updated_at: string;
  parent_id?: string;            // For sub-projects
}
```

## Lineage Events

Project history tracking.

```typescript
interface LineageEvent {
  id: string;
  project_id: string;
  event_type: 'created' | 'decision' | 'pivot' | 'milestone' | 'insight' | 'delegation';
  title: string;
  description: string;
  timestamp: string;
  source_ids: string[];          // Related sources
}
```

## Vector Store Schema

### Sources Table

Stores source document metadata with summary embedding.

| Column | Type | Description |
|--------|------|-------------|
| id | string | Primary key |
| title | string | Document title |
| source_type | string | Origin type |
| content_type | string | Content type |
| projects | JSON string | Project IDs |
| tags | JSON string | Tags |
| created_at | string | ISO date |
| summary | string | LLM-generated summary |
| themes_json | JSON string | Extracted themes |
| quotes_json | JSON string | Extracted quotes |
| has_full_content | boolean | If full content on disk |
| content | text | Full document content (cloud sync, ≤500KB) |
| content_size | integer | Content size in bytes |
| content_hash | string | SHA256 hash for deduplication |
| source_path | string | Original file path (if synced from disk) |
| source_url | string | Original URL (if applicable) |
| source_name | string | Human-readable source label |
| vector | float[1536] | Summary embedding |

### Chunks Table

Fine-grained search across quotes, themes, decisions.

| Column | Type | Description |
|--------|------|-------------|
| id | string | {source_id}_{type}_{index} |
| source_id | string | Parent source |
| content | string | Chunk text |
| type | string | 'quote' | 'theme' | 'decision' | ... |
| theme_name | string | If applicable |
| speaker | string | If quote |
| timestamp | string | If applicable |
| vector | float[1536] | Chunk embedding |

## File Storage

```
data/
├── sources/
│   └── {source_id}/
│       ├── content.md         # Full original content
│       ├── metadata.json      # Source metadata
│       └── extracted.json     # Themes, quotes, etc.
├── retained/
│   └── {project}/
│       └── {type}-{id}.json   # Explicitly retained items
├── projects/
│   └── {project_id}.json      # Project metadata
└── lore.lance/                # Vector database
```
