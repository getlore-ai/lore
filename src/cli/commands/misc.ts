/**
 * Miscellaneous CLI Commands
 *
 * browse, research, init, serve
 */

import type { Command } from 'commander';
import path from 'path';

export function registerMiscCommands(program: Command, defaultDataDir: string): void {
  // Browse command (TUI)
  program
    .command('browse')
    .description('Browse documents in an interactive terminal UI')
    .option('-p, --project <project>', 'Filter by project')
    .option('-t, --type <type>', 'Filter by source type')
    .option('-l, --limit <limit>', 'Max documents to load (omit to show all)')
    .option('-d, --data-dir <dir>', 'Data directory', defaultDataDir)
    .action(async (options) => {
      const { startBrowser } = await import('../../tui/browse.js');

      await startBrowser({
        project: options.project,
        sourceType: options.type,
        limit: options.limit ? parseInt(options.limit, 10) : undefined,
        dataDir: options.dataDir,
      });
    });

  // Research command (top-level for discoverability)
  program
    .command('research')
    .description('Deep AI-powered research on a topic')
    .argument('<query>', 'Research query')
    .option('-p, --project <project>', 'Focus on specific project')
    .option('-d, --data-dir <dir>', 'Data directory', defaultDataDir)
    .option('--depth <depth>', 'Research depth: quick (~30-60s), standard (~1-2 min, default), deep (~4-8 min)', 'standard')
    .option('--simple', 'Use simple fallback mode (single-pass GPT-4o-mini, no agent)')
    .action(async (query, options) => {
      const { handleResearch } = await import('../../mcp/handlers/research.js');
      const dataDir = options.dataDir;
      const dbPath = path.join(dataDir, 'lore.lance');

      // --simple is an alias for --depth quick
      if (options.simple) {
        process.env.LORE_RESEARCH_MODE = 'simple';
      }

      const depth = options.simple ? 'quick' : (options.depth || 'standard');
      const depthLabels: Record<string, string> = {
        quick: '~30-60 seconds',
        standard: '~1-2 minutes',
        deep: '~4-8 minutes',
      };

      console.log(`\nResearching: "${query}" (${depth}, ${depthLabels[depth] || ''})\n`);
      console.log('This may take a moment...\n');

      const result = await handleResearch(
        dbPath,
        dataDir,
        {
          task: query,
          project: options.project,
          include_sources: true,
          depth,
        },
        {
          hookContext: { mode: 'cli' },
        }
      );

      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      console.log(`📊 Research Results`);
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

      console.log(`Summary:\n${result.summary}\n`);

      if (result.key_findings && result.key_findings.length > 0) {
        console.log(`Key Findings:`);
        for (const finding of result.key_findings) {
          console.log(`  • ${finding}`);
        }
        console.log('');
      }

      if (result.conflicts_resolved && result.conflicts_resolved.length > 0) {
        console.log(`Conflicts Resolved:`);
        for (const conflict of result.conflicts_resolved) {
          console.log(`  ⚡ ${conflict}`);
        }
        console.log('');
      }

      if (result.supporting_quotes && result.supporting_quotes.length > 0) {
        console.log(`Supporting Quotes (${result.supporting_quotes.length}):`);
        for (const quote of result.supporting_quotes.slice(0, 5)) {
          const speaker = quote.speaker === 'user' ? '[You]' : '[Participant]';
          console.log(`  ${speaker} "${quote.text.substring(0, 80)}${quote.text.length > 80 ? '...' : ''}"`);
        }
        if (result.supporting_quotes.length > 5) {
          console.log(`  ... and ${result.supporting_quotes.length - 5} more`);
        }
        console.log('');
      }

      if (result.sources_consulted && result.sources_consulted.length > 0) {
        console.log(`Sources Consulted (${result.sources_consulted.length}):`);
        for (const source of result.sources_consulted.slice(0, 5)) {
          const relevance = source.relevance ? ` (${(source.relevance * 100).toFixed(0)}%)` : '';
          console.log(`  • ${source.title}${relevance}`);
        }
        if (result.sources_consulted.length > 5) {
          console.log(`  ... and ${result.sources_consulted.length - 5} more`);
        }
        console.log('');
      }

      if (result.gaps_identified && result.gaps_identified.length > 0) {
        console.log(`Gaps Identified:`);
        for (const gap of result.gaps_identified) {
          console.log(`  ? ${gap}`);
        }
        console.log('');
      }

      if (result.suggested_queries && result.suggested_queries.length > 0) {
        console.log(`Suggested Follow-up Queries:`);
        for (const q of result.suggested_queries) {
          console.log(`  → ${q}`);
        }
        console.log('');
      }
    });

  // Init command
  program
    .command('init')
    .description('Initialize a new Lore data repository')
    .argument('[path]', 'Path for the data repository', '~/.lore')
    .option('--remote <url>', 'Git remote URL for cross-machine sync')
    .action(async (targetPath, options) => {
      const { initDataRepo, getGitRemoteUrl } = await import('../../core/data-repo.js');
      const { execSync } = await import('child_process');

      // Expand ~ to home directory
      const expandedPath = targetPath.replace(/^~/, process.env.HOME || '~');

      console.log(`\nLore Init`);
      console.log(`=========`);
      console.log(`Creating data repository at: ${expandedPath}\n`);

      const initResult = await initDataRepo(expandedPath);
      if (initResult.gitInitialized) {
        console.log('✓ Created data repository');
      } else {
        console.log(`✓ Created data directory (git init issue: ${initResult.error || 'unknown'})`);
      }

      // Add remote if provided
      if (options.remote) {
        try {
          execSync(`git remote add origin ${options.remote}`, { cwd: expandedPath, stdio: 'pipe' });
          console.log(`✓ Added remote: ${options.remote}`);

          try {
            execSync('git push -u origin main', { cwd: expandedPath, stdio: 'pipe' });
            console.log('✓ Pushed to remote');
          } catch {
            console.log('⚠ Could not push to remote (you may need to push manually)');
          }
        } catch {
          // Remote may already exist
          const existing = getGitRemoteUrl(expandedPath);
          if (existing) {
            console.log(`✓ Remote already set: ${existing}`);
          }
        }
      }

      console.log(`
Done! To use this data repository:

1. Set the environment variable:
   export LORE_DATA_DIR=${expandedPath}

2. Or add to your MCP config:
   "env": { "LORE_DATA_DIR": "${expandedPath}" }

3. Add sync sources:
   lore sync add --name "My Notes" --path ~/notes -p myproject

Tip: Run 'lore setup' for the full guided experience (config + login + data repo).
`);
    });

  // MCP server command
  program
    .command('mcp')
    .description('Start the MCP server')
    .option('-w, --watch', 'Watch extensions and auto-reload')
    .option('--sandbox', 'Run extension tools in worker thread sandbox')
    .action(async (options) => {
      if (options.watch) {
        process.env.LORE_EXTENSION_WATCH = 'true';
      }
      if (options.sandbox) {
        process.env.LORE_EXTENSION_SANDBOX = 'true';
      }
      // Dynamic import to start MCP server
      await import('../../mcp/server.js');
    });
}
