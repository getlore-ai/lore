/**
 * CLI Helper Functions
 *
 * Shared utilities for CLI commands.
 */

import path from 'path';
import { mkdir, writeFile } from 'fs/promises';

import {
  initializeTables,
  storeSources,
} from '../core/vector-store.js';
import { generateEmbeddings, createSearchableText } from '../core/embedder.js';
import type { SourceDocument, SourceRecord, Quote, Theme } from '../core/types.js';

/**
 * Build vector index for ingested sources
 */
export async function buildIndex(
  dataDir: string,
  results: Array<{
    source: SourceDocument;
    notes: string;
    transcript: string;
    insights?: { summary: string; themes: Theme[]; quotes: Quote[] };
  }>
): Promise<void> {
  const dbPath = path.join(dataDir, 'lore.lance');

  // Initialize tables
  await initializeTables(dbPath);

  // Prepare source records
  const sourceRecords: Array<{ source: SourceRecord; vector: number[] }> = [];

  // Collect all texts for batch embedding (source summaries only)
  const textsToEmbed: { id: string; text: string }[] = [];

  for (const result of results) {
    const { source, insights } = result;
    const summary = insights?.summary || source.content.substring(0, 500);

    // Add summary for source embedding
    textsToEmbed.push({
      id: `source_${source.id}`,
      text: createSearchableText({ type: 'summary', text: summary, project: source.projects[0] }),
    });
  }

  // Generate embeddings in batch
  console.log(`  Generating ${textsToEmbed.length} embeddings...`);
  const embeddings = await generateEmbeddings(
    textsToEmbed.map((t) => t.text),
    undefined,
    {
      onProgress: (completed, total) => {
        process.stdout.write(`\r  Embeddings: ${completed}/${total}`);
      },
    }
  );
  console.log('');

  // Map embeddings back
  const embeddingMap = new Map<string, number[]>();
  for (let i = 0; i < textsToEmbed.length; i++) {
    embeddingMap.set(textsToEmbed[i].id, embeddings[i]);
  }

  // Build records
  for (const result of results) {
    const { source, insights } = result;
    const summary = insights?.summary || source.content.substring(0, 500);
    const themes = insights?.themes || [];

    // Source record
    sourceRecords.push({
      source: {
        id: source.id,
        title: source.title,
        source_type: source.source_type,
        content_type: source.content_type,
        projects: JSON.stringify(source.projects),
        tags: JSON.stringify(source.tags),
        created_at: source.created_at,
        summary,
        themes_json: JSON.stringify(themes),
        quotes_json: JSON.stringify([]),
        has_full_content: true,
        vector: [],
      },
      vector: embeddingMap.get(`source_${source.id}`) || [],
    });
  }

  // Store in database
  console.log(`  Storing ${sourceRecords.length} sources...`);
  await storeSources(dbPath, sourceRecords);
}

/**
 * Save ingested sources to disk
 */
export async function saveSourcesToDisk(
  sourcesDir: string,
  results: Array<{
    source: SourceDocument;
    insights?: { summary: string; themes: Theme[]; quotes: Quote[] };
  }>
): Promise<void> {
  for (const result of results) {
    const sourceDir = path.join(sourcesDir, result.source.id);
    await mkdir(sourceDir, { recursive: true });

    // Save content
    await writeFile(path.join(sourceDir, 'content.md'), result.source.content);

    // Save metadata
    const metadata = {
      id: result.source.id,
      title: result.source.title,
      source_type: result.source.source_type,
      content_type: result.source.content_type,
      created_at: result.source.created_at,
      imported_at: result.source.imported_at,
      projects: result.source.projects,
      tags: result.source.tags,
      source_path: result.source.source_path,
    };
    await writeFile(path.join(sourceDir, 'metadata.json'), JSON.stringify(metadata, null, 2));

    // Save insights if extracted
    if (result.insights) {
      await writeFile(path.join(sourceDir, 'insights.json'), JSON.stringify(result.insights, null, 2));
    }
  }
}
