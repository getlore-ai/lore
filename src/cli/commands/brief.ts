/**
 * Brief CLI Commands
 *
 * View, generate, and manage living project briefs.
 */

import type { Command } from 'commander';
import path from 'path';

import { indexExists } from '../../core/vector-store.js';

export function registerBriefCommand(program: Command, defaultDataDir: string): void {
  const briefCmd = program
    .command('brief')
    .description('Project briefs — living synthesis of project knowledge');

  // View brief (default action): `lore brief <project>`
  briefCmd
    .command('show', { isDefault: true })
    .description('Show the current brief for a project')
    .argument('<project>', 'Project name')
    .option('-d, --data-dir <dir>', 'Data directory', defaultDataDir)
    .option('--json', 'Output raw JSON')
    .action(async (projectName, options) => {
      const dataDir = options.dataDir;
      const dbPath = path.join(dataDir, 'lore.lance');

      if (!(await indexExists(dbPath))) {
        console.log('No index found. Run "lore sync" first.');
        process.exit(1);
      }

      const { getBriefWithStaleness } = await import('../../core/brief.js');
      const brief = await getBriefWithStaleness(dbPath, projectName.toLowerCase().trim());

      if (!brief) {
        console.log(`\nNo brief exists for project "${projectName}".`);
        console.log('Generate one with: lore brief generate ' + projectName);
        return;
      }

      if (options.json) {
        console.log(JSON.stringify(brief, null, 2));
        return;
      }

      // Formatted output
      console.log('');
      console.log(`PROJECT BRIEF: ${brief.project}`);
      console.log(`Version ${brief.version} | Generated ${new Date(brief.generated_at).toLocaleDateString()}`);
      if (brief.stale) {
        console.log(`[STALE] ${brief.sources_since} new source(s) since generation. Run: lore brief generate ${projectName}`);
      }
      if (brief.focus) {
        console.log(`Focus: ${brief.focus}`);
      }
      console.log('━'.repeat(60));

      console.log('\n## Current State\n');
      console.log(brief.current_state);

      console.log('\n## Key Evidence\n');
      for (const e of brief.key_evidence) {
        console.log(`  - ${e.claim}`);
        if (e.quote) {
          console.log(`    "${e.quote}"`);
        }
        console.log(`    Source: ${e.source_title} (${e.date})`);
      }

      console.log('\n## Open Questions\n');
      for (const q of brief.open_questions) {
        console.log(`  - ${q}`);
      }

      console.log('\n## Trajectory\n');
      console.log(brief.trajectory);

      if (brief.recent_changes) {
        console.log('\n## Recent Changes\n');
        console.log(brief.recent_changes);
      }

      console.log(`\nSources analyzed: ${brief.source_count_at_generation}`);
      console.log('');
    });

  // Generate brief: `lore brief generate <project>`
  briefCmd
    .command('generate')
    .description('Generate or refresh a project brief')
    .argument('<project>', 'Project name')
    .option('-f, --focus <focus>', 'Focus area for the brief')
    .option('--full', 'Force full regeneration (skip incremental mode)')
    .option('-d, --data-dir <dir>', 'Data directory', defaultDataDir)
    .option('--json', 'Output raw JSON')
    .action(async (projectName, options) => {
      const dataDir = options.dataDir;
      const dbPath = path.join(dataDir, 'lore.lance');

      if (!(await indexExists(dbPath))) {
        console.log('No index found. Run "lore sync" first.');
        process.exit(1);
      }

      const { generateBrief } = await import('../../core/brief.js');

      const focusNote = options.focus ? ` (focus: "${options.focus}")` : '';
      const fullNote = options.full ? ' [full]' : '';
      console.log(`\nGenerating brief for "${projectName}"${focusNote}${fullNote}...`);

      try {
        const brief = await generateBrief(dbPath, dataDir, projectName.toLowerCase().trim(), {
          focus: options.focus,
          full: options.full,
          onProgress: (message) => {
            console.log(`  ${message}`);
          },
        });

        if (options.json) {
          console.log(JSON.stringify(brief, null, 2));
          return;
        }

        console.log(`\nBrief v${brief.version} generated (${brief.key_evidence.length} evidence items, ${brief.open_questions.length} open questions)`);
        console.log(`\nRun "lore brief ${projectName}" to view it.`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`\nFailed to generate brief: ${message}`);
        process.exit(1);
      }
    });

  // List all briefs: `lore brief list`
  briefCmd
    .command('list')
    .description('List all project briefs with staleness info')
    .option('-d, --data-dir <dir>', 'Data directory', defaultDataDir)
    .action(async (options) => {
      const dataDir = options.dataDir;
      const dbPath = path.join(dataDir, 'lore.lance');

      if (!(await indexExists(dbPath))) {
        console.log('No index found. Run "lore sync" first.');
        process.exit(1);
      }

      const { getAllBriefStatuses } = await import('../../core/brief.js');

      const { briefs: briefStatuses, projectStats: projects } = await getAllBriefStatuses(dbPath);

      console.log(`\nProject Briefs:`);
      console.log('━'.repeat(60));

      if (projects.length === 0) {
        console.log('No projects found.');
        return;
      }

      for (const p of projects) {
        const status = briefStatuses.get(p.project);
        if (status) {
          const staleTag = status.stale
            ? `(stale - ${status.sources_since} new)`
            : '(current)';
          const date = new Date(status.generated_at).toLocaleDateString();
          console.log(`  ${p.project.padEnd(25)} v${status.version}  ${staleTag.padEnd(22)} Updated: ${date}`);
        } else {
          console.log(`  ${p.project.padEnd(25)} --  (no brief yet)`);
        }
      }
      console.log('');
    });

  // Brief history: `lore brief history <project>`
  briefCmd
    .command('history')
    .description('Show version history for a project brief')
    .argument('<project>', 'Project name')
    .option('-l, --limit <count>', 'Number of versions to show', '10')
    .option('-d, --data-dir <dir>', 'Data directory', defaultDataDir)
    .action(async (projectName, options) => {
      const dataDir = options.dataDir;
      const dbPath = path.join(dataDir, 'lore.lance');

      if (!(await indexExists(dbPath))) {
        console.log('No index found. Run "lore sync" first.');
        process.exit(1);
      }

      const limitValue = parseInt(options.limit, 10);
      if (isNaN(limitValue) || limitValue < 1) {
        console.error('--limit must be a positive integer');
        process.exit(1);
      }

      const { getBriefHistory } = await import('../../core/brief.js');
      const history = await getBriefHistory(dbPath, projectName.toLowerCase().trim(), {
        limit: limitValue,
      });

      if (history.length === 0) {
        console.log(`\nNo brief history for project "${projectName}".`);
        return;
      }

      console.log(`\nBrief History: ${projectName} (${history.length} versions)`);
      console.log('━'.repeat(60));

      for (const brief of history) {
        const date = new Date(brief.generated_at).toLocaleString();
        const focus = brief.focus ? ` [focus: ${brief.focus}]` : '';
        console.log(`\n  v${brief.version} | ${date} | ${brief.source_count_at_generation} sources${focus}`);
        if (brief.recent_changes) {
          // Show first 120 chars of recent changes
          const preview = brief.recent_changes.substring(0, 120).replace(/\n/g, ' ');
          console.log(`    Changes: ${preview}${brief.recent_changes.length > 120 ? '...' : ''}`);
        }
      }
      console.log('');
    });

  // Diff: `lore brief diff <project>`
  briefCmd
    .command('diff')
    .description('Compare latest brief with previous version')
    .argument('<project>', 'Project name')
    .option('-d, --data-dir <dir>', 'Data directory', defaultDataDir)
    .action(async (projectName, options) => {
      const dataDir = options.dataDir;
      const dbPath = path.join(dataDir, 'lore.lance');

      if (!(await indexExists(dbPath))) {
        console.log('No index found. Run "lore sync" first.');
        process.exit(1);
      }

      const { getBriefHistory } = await import('../../core/brief.js');
      const history = await getBriefHistory(dbPath, projectName.toLowerCase().trim(), { limit: 2 });

      if (history.length < 2) {
        console.log(`\nNeed at least 2 versions to diff. Project "${projectName}" has ${history.length}.`);
        return;
      }

      const [latest, previous] = history;

      console.log(`\nBrief Diff: ${projectName}`);
      console.log(`v${previous.version} (${new Date(previous.generated_at).toLocaleDateString()}) → v${latest.version} (${new Date(latest.generated_at).toLocaleDateString()})`);
      console.log(`Sources: ${previous.source_count_at_generation} → ${latest.source_count_at_generation} (+${latest.source_count_at_generation - previous.source_count_at_generation})`);
      console.log('━'.repeat(60));

      if (latest.recent_changes) {
        console.log('\n## What Changed\n');
        console.log(latest.recent_changes);
      }

      // Show new open questions
      const prevQuestions = new Set(previous.open_questions);
      const newQuestions = latest.open_questions.filter((q) => !prevQuestions.has(q));
      const resolvedQuestions = previous.open_questions.filter(
        (q) => !latest.open_questions.includes(q)
      );

      if (newQuestions.length > 0) {
        console.log('\n## New Open Questions\n');
        for (const q of newQuestions) {
          console.log(`  + ${q}`);
        }
      }

      if (resolvedQuestions.length > 0) {
        console.log('\n## Resolved Questions\n');
        for (const q of resolvedQuestions) {
          console.log(`  - ${q}`);
        }
      }

      // Show new evidence
      const prevEvidenceIds = new Set(previous.key_evidence.map((e) => e.source_id));
      const newEvidence = latest.key_evidence.filter((e) => !prevEvidenceIds.has(e.source_id));

      if (newEvidence.length > 0) {
        console.log('\n## New Key Evidence\n');
        for (const e of newEvidence) {
          console.log(`  + ${e.claim}`);
          console.log(`    Source: ${e.source_title} (${e.date})`);
        }
      }

      console.log('');
    });
}
