# Integrating with granola-extractor

## Background

The `granola-extractor` repo (located at `~/workspace/granola-extractor`) was built first to:
1. Export meeting notes from the Granola app
2. Extract themes and quotes using GPT-4o-mini
3. Build a vector index for semantic search
4. Expose an MCP server for Claude access

## Relationship to Lore

Lore subsumes and extends granola-extractor's functionality:

| granola-extractor | Lore |
|-------------------|------|
| Single source (Granola) | Multiple sources |
| Meeting-focused | All knowledge types |
| Standalone MCP | Unified MCP |
| No project organization | Project-first |
| No lineage tracking | Full lineage |
| No explicit retention | `retain` tool |

## Reused Code

The following was adapted from granola-extractor:

### embedder.ts
- OpenAI embedding generation
- Retry logic with exponential backoff
- Batch processing
- `createSearchableText` helper

### vector-store.ts
- LanceDB connection management
- Table initialization
- Semantic search
- Adapted schema for Lore's needs

### MCP server pattern
- Same SDK and transport
- Handler structure
- Error handling

## Integration Options

### Option 1: Separate Repos (Current)

```
granola-extractor/
├── Exports from Granola → export/
└── Has its own MCP server

lore/
├── Ingests granola-extractor exports
└── Unified MCP server
```

**Workflow:**
1. Run `granola-mcp export` to get latest from Granola
2. Run `lore ingest ~/workspace/granola-extractor/export --type granola`
3. Use Lore's MCP server

**Pros:** Clean separation, granola-extractor still works standalone
**Cons:** Two-step process, potential duplication

### Option 2: Granola Adapter in Lore

Move the Granola API client and extraction logic into Lore:

```
lore/
└── src/ingest/granola/
    ├── api.ts         # Granola API client
    ├── credentials.ts # macOS keychain access
    ├── converter.ts   # ProseMirror → Markdown
    └── extractor.ts   # Theme/quote extraction
```

**Workflow:**
1. Run `lore ingest --type granola --live` to fetch directly from Granola
2. Or `lore ingest <export-dir> --type granola` for existing exports

**Pros:** Single system, direct access
**Cons:** More code to maintain, duplicates granola-extractor

### Option 3: Shared Library

Extract common code into a shared package:

```
packages/
├── knowledge-core/
│   ├── embedder.ts
│   ├── vector-store.ts
│   └── types.ts
├── granola-extractor/
│   └── Uses knowledge-core
└── lore/
    └── Uses knowledge-core
```

**Pros:** No duplication, clean architecture
**Cons:** More complex setup, monorepo management

## Recommended Approach

**Start with Option 1**, then evolve:

1. **Now**: Use granola-extractor exports as input to Lore
2. **Soon**: Build Lore's Granola adapter that reads export format
3. **Later**: Consider moving Granola API access into Lore if needed
4. **Eventually**: Deprecate granola-extractor's MCP in favor of Lore

## Export Format Reference

granola-extractor produces:

```
export/
├── Meeting_Name_Date/
│   ├── document.json      # Raw Granola API response
│   ├── notes.md           # Converted notes
│   ├── transcript.json    # Structured transcript
│   ├── transcript.md      # Formatted transcript
│   └── transcript.txt     # Plain text transcript
└── vectors.lance/         # Vector database
```

### document.json Structure

```json
{
  "id": "uuid",
  "title": "Meeting Title",
  "created_at": "ISO date",
  "content": { /* ProseMirror JSON */ },
  "folders": ["Folder Name"],
  "shared_link_enabled": false
}
```

### transcript.json Structure

```json
{
  "panels": [...],
  "utterances": [
    {
      "text": "What the person said",
      "start": 0.0,
      "end": 5.0,
      "source": "microphone" | "system"
    }
  ]
}
```

Speaker attribution:
- `source: "microphone"` = You (the host)
- `source: "system"` = Other participants

## Lore Ingestion

When Lore ingests a Granola export:

1. Read `document.json` for metadata
2. Read `notes.md` for the notes content
3. Read `transcript.json` or `transcript.md` for full transcript
4. Run theme/quote extraction (reuse granola-extractor logic or call GPT)
5. Create SourceDocument with proper citations
6. Generate embeddings
7. Store in Lore's vector database

The key addition is **proper citation linking**:
- Every quote links back to source document
- Timestamps enable precise navigation
- Speaker attribution preserved
