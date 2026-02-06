/**
 * Search Command
 *
 * Search the knowledge repository with various modes.
 */

import type { Command } from 'commander';
import path from 'path';

import { indexExists, searchSources, getSourceById } from '../../core/vector-store.js';
import { generateEmbedding } from '../../core/embedder.js';

export function registerSearchCommand(program: Command, defaultDataDir: string): void {
  program
    .command('search')
    .description('Search the knowledge repository')
    .argument('<query>', 'Search query')
    .option('-p, --project <project>', 'Filter by project')
    .option('-l, --limit <limit>', 'Max results', '5')
    .option('-m, --mode <mode>', 'Search mode: semantic, keyword, hybrid (default), regex', 'hybrid')
    .option('-d, --data-dir <dir>', 'Data directory', defaultDataDir)
    .action(async (query, options) => {
      const dataDir = options.dataDir;
      const dbPath = path.join(dataDir, 'lore.lance');
      const searchMode = options.mode as 'semantic' | 'keyword' | 'hybrid' | 'regex';

      try {
        if (!(await indexExists(dbPath))) {
          console.log('No index found. Run "lore ingest" first.');
          process.exit(1);
        }

        console.log(`\nSearching for: "${query}" (mode: ${searchMode})\n`);

        // Handle regex mode separately
        if (searchMode === 'regex') {
          const { searchLocalFiles, getMatchSnippet } = await import('../../core/local-search.js');
          const results = await searchLocalFiles(dataDir, query, {
            maxTotalResults: parseInt(options.limit),
            maxMatchesPerFile: 5,
          });

          if (results.length === 0) {
            console.log('No regex matches found.');
            return;
          }

          for (const result of results) {
            const sourceData = await getSourceById(dbPath, result.source_id);

            console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
            console.log(`📄 ${sourceData?.title || result.source_id}`);
            if (sourceData) {
              console.log(`   Type: ${sourceData.source_type} | ${sourceData.content_type}`);
              console.log(`   Projects: ${sourceData.projects.join(', ') || '(none)'}`);
            }
            console.log(`   Matches: ${result.matches.length}`);
            console.log('');

            for (const match of result.matches.slice(0, 5)) {
              const snippet = getMatchSnippet(match.line_content, match.match_start, match.match_end, 80);
              console.log(`   Line ${match.line_number}: ${snippet}`);
            }
            if (result.matches.length > 5) {
              console.log(`   ... and ${result.matches.length - 5} more matches`);
            }
            console.log('');
          }
          return;
        }

        // Semantic/keyword/hybrid search
        const queryVector = await generateEmbedding(query);
        const results = await searchSources(dbPath, queryVector, {
          limit: parseInt(options.limit),
          project: options.project,
          mode: searchMode,
          queryText: query,
        });

        if (results.length === 0) {
          console.log('No results found.');
          return;
        }

        for (const result of results) {
          console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
          console.log(`📄 ${result.title}`);
          console.log(`   Type: ${result.source_type} | ${result.content_type}`);
          console.log(`   Projects: ${result.projects.join(', ') || '(none)'}`);

          // Show score and ranks for hybrid mode
          if (searchMode === 'hybrid' && (result.semantic_rank || result.keyword_rank)) {
            const semRank = result.semantic_rank ? `sem=#${result.semantic_rank}` : '';
            const kwRank = result.keyword_rank ? `kw=#${result.keyword_rank}` : '';
            console.log(`   Score: ${(result.score * 100).toFixed(1)}% [${[semRank, kwRank].filter(Boolean).join(' ')}]`);
          } else {
            console.log(`   Score: ${(result.score * 100).toFixed(1)}%`);
          }
          console.log(`\n   ${result.summary}\n`);

          if (result.quotes.length > 0) {
            console.log(`   Key Quotes:`);
            for (const quote of result.quotes.slice(0, 3)) {
              const speaker = quote.speaker === 'user' ? '[You]' : '[Participant]';
              console.log(`   • ${speaker} "${quote.text.substring(0, 100)}..."`);
            }
          }
          console.log('');
        }
      } catch (error) {
        console.error(`Error: ${error instanceof Error ? error.message : error}`);
        process.exit(1);
      }
    });
}
