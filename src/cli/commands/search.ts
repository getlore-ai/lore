/**
 * Search Command
 *
 * Search the knowledge repository with various modes.
 */

import type { Command } from 'commander';
import path from 'path';

import { indexExists, searchSources, getSourceById } from '../../core/vector-store.js';
import { generateEmbedding } from '../../core/embedder.js';
import { detectTemporalIntent, parseDateArg, filterByDateRange, sortByRecency, formatDate } from '../../core/temporal.js';

export function registerSearchCommand(program: Command, defaultDataDir: string): void {
  program
    .command('search')
    .description('Search the knowledge repository')
    .argument('<query>', 'Search query')
    .option('-p, --project <project>', 'Filter by project')
    .option('-l, --limit <limit>', 'Max results', '5')
    .option('-m, --mode <mode>', 'Search mode: semantic, keyword, hybrid (default), regex', 'hybrid')
    .option('--since <date>', 'Only show sources after this date (ISO, 7d, 2w, 1m, "last week")')
    .option('--before <date>', 'Only show sources before this date (ISO, 7d, 2w, 1m)')
    .option('-s, --sort <order>', 'Sort order: relevance (default), recent', 'relevance')
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

        // Detect temporal intent for recency boosting
        const temporal = detectTemporalIntent(query);
        const requestedLimit = parseInt(options.limit);

        // Parse date filters
        const since = options.since ? parseDateArg(options.since) : null;
        const before = options.before ? parseDateArg(options.before) : null;

        if (options.since && !since) {
          console.error(`Warning: Could not parse --since value "${options.since}". Use ISO date, 7d, 2w, 1m, or "last week".`);
        }
        if (options.before && !before) {
          console.error(`Warning: Could not parse --before value "${options.before}". Use ISO date, 7d, 2w, 1m.`);
        }

        // Fetch extra results when date-filtering to ensure we get enough after filtering
        const fetchLimit = (since || before) ? requestedLimit * 2 : requestedLimit;

        // Semantic/keyword/hybrid search
        const queryVector = await generateEmbedding(query);
        let results = await searchSources(dbPath, queryVector, {
          limit: fetchLimit,
          project: options.project,
          mode: searchMode,
          queryText: query,
          recency_boost: temporal.recencyBoost,
        });

        // Post-filter by date range
        if (since || before) {
          results = filterByDateRange(results, since, before);
        }

        // Sort by date if requested or temporal intent detected
        if (options.sort === 'recent' || temporal.sortByDate) {
          results = sortByRecency(results);
        }

        // Trim to requested limit
        results = results.slice(0, requestedLimit);

        if (results.length === 0) {
          console.log('No results found.');
          return;
        }

        for (const result of results) {
          console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
          console.log(`📄 ${result.title}`);
          console.log(`   Date: ${formatDate(result.created_at)}`);
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
