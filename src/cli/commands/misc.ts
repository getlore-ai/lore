/**
 * Miscellaneous CLI Commands
 *
 * browse, research, init, serve
 */

import type { Command } from 'commander';
import path from 'path';
import { mkdir, writeFile } from 'fs/promises';

export function registerMiscCommands(program: Command, defaultDataDir: string): void {
  // Browse command (TUI)
  program
    .command('browse')
    .description('Browse documents in an interactive terminal UI')
    .option('-p, --project <project>', 'Filter by project')
    .option('-t, --type <type>', 'Filter by source type')
    .option('-l, --limit <limit>', 'Max documents to load', '100')
    .option('-d, --data-dir <dir>', 'Data directory', defaultDataDir)
    .action(async (options) => {
      const { startBrowser } = await import('../../tui/browse.js');

      await startBrowser({
        project: options.project,
        sourceType: options.type,
        limit: parseInt(options.limit, 10),
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
    .option('--simple', 'Use simple mode (single-pass, faster)')
    .action(async (query, options) => {
      const { handleResearch } = await import('../../mcp/handlers/research.js');
      const dataDir = options.dataDir;
      const dbPath = path.join(dataDir, 'lore.lance');

      if (options.simple) {
        process.env.LORE_RESEARCH_MODE = 'simple';
      }

      console.log(`\nResearching: "${query}"\n`);
      console.log('This may take a moment...\n');

      const result = await handleResearch(dbPath, dataDir, {
        task: query,
        project: options.project,
        include_sources: true,
      });

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
    .argument('[path]', 'Path for the data repository', '~/lore-data')
    .option('--remote <url>', 'Git remote URL for cross-machine sync')
    .action(async (targetPath, options) => {
      const { execSync } = await import('child_process');

      // Expand ~ to home directory
      const expandedPath = targetPath.replace(/^~/, process.env.HOME || '~');

      console.log(`\nLore Init`);
      console.log(`=========`);
      console.log(`Creating data repository at: ${expandedPath}\n`);

      // Create directory structure
      await mkdir(expandedPath, { recursive: true });
      await mkdir(path.join(expandedPath, 'sources'), { recursive: true });
      await mkdir(path.join(expandedPath, 'retained'), { recursive: true });

      // Create .gitignore
      const gitignore = `# Environment files
.env
.env.local
`;
      await writeFile(path.join(expandedPath, '.gitignore'), gitignore);

      // Create README
      const readme = `# Lore Data Repository

Your personal knowledge repository for Lore.

## Structure

- \`sources/\` - Ingested documents
- \`retained/\` - Explicitly saved insights

Vector embeddings are stored in Supabase (cloud) for multi-machine access.

## Usage

Set \`LORE_DATA_DIR=${expandedPath}\` in your environment or MCP config.
`;
      await writeFile(path.join(expandedPath, 'README.md'), readme);

      console.log('✓ Created directory structure');

      // Initialize git
      try {
        execSync('git init', { cwd: expandedPath, stdio: 'pipe' });
        console.log('✓ Initialized git repository');

        // Add and commit
        execSync('git add .', { cwd: expandedPath, stdio: 'pipe' });
        execSync('git commit -m "Initial lore data repository"', { cwd: expandedPath, stdio: 'pipe' });
        console.log('✓ Created initial commit');

        // Add remote if provided
        if (options.remote) {
          execSync(`git remote add origin ${options.remote}`, { cwd: expandedPath, stdio: 'pipe' });
          console.log(`✓ Added remote: ${options.remote}`);

          try {
            execSync('git push -u origin main', { cwd: expandedPath, stdio: 'pipe' });
            console.log('✓ Pushed to remote');
          } catch {
            console.log('⚠ Could not push to remote (you may need to push manually)');
          }
        }
      } catch (error) {
        console.log('⚠ Git initialization failed (git may not be installed)');
      }

      console.log(`
Done! To use this data repository:

1. Set the environment variable:
   export LORE_DATA_DIR=${expandedPath}

2. Or add to your MCP config:
   "env": { "LORE_DATA_DIR": "${expandedPath}" }

3. Add sync sources:
   lore sync add --name "My Notes" --path ~/notes --glob "**/*.md" -p myproject
`);
    });

  // Serve command (MCP server)
  program
    .command('serve')
    .description('Start the MCP server')
    .action(async () => {
      // Dynamic import to start MCP server
      await import('../../mcp/server.js');
    });
}
