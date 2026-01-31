/**
 * Projects CLI Commands
 *
 * Project management: list, archive, delete
 */

import type { Command } from 'commander';
import path from 'path';

import { indexExists } from '../../core/vector-store.js';

export function registerProjectsCommand(program: Command, defaultDataDir: string): void {
  const projectsCmd = program
    .command('projects')
    .description('Project management');

  // List projects (default action)
  projectsCmd
    .command('list', { isDefault: true })
    .description('List all projects')
    .option('-d, --data-dir <dir>', 'Data directory', defaultDataDir)
    .action(async (options) => {
      const dataDir = options.dataDir;
      const dbPath = path.join(dataDir, 'lore.lance');

      if (!(await indexExists(dbPath))) {
        console.log('No index found. Run "lore sync" first.');
        process.exit(1);
      }

      const { getProjectStats } = await import('../../core/vector-store.js');
      const projects = await getProjectStats(dbPath);

      console.log(`\nProjects (${projects.length}):`);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

      if (projects.length === 0) {
        console.log('No projects found.');
        return;
      }

      for (const p of projects) {
        console.log(`\n📁 ${p.project}`);
        console.log(`   Sources: ${p.source_count} | Quotes: ${p.quote_count}`);
        console.log(`   Latest: ${new Date(p.latest_activity).toLocaleDateString()}`);
      }
      console.log('');
    });

  // Archive project
  projectsCmd
    .command('archive')
    .description('Archive a project (hide from search)')
    .argument('<name>', 'Project name to archive')
    .option('-r, --reason <reason>', 'Reason for archiving')
    .option('-s, --successor <project>', 'Successor project name')
    .option('-d, --data-dir <dir>', 'Data directory', defaultDataDir)
    .option('--no-push', 'Skip git push')
    .action(async (projectName, options) => {
      const { handleArchiveProject } = await import('../../mcp/handlers/archive-project.js');
      const dataDir = options.dataDir;
      const dbPath = path.join(dataDir, 'lore.lance');

      const result = await handleArchiveProject(dbPath, dataDir, {
        project: projectName,
        reason: options.reason,
        successor_project: options.successor,
      }, { autoPush: options.push !== false });

      if (result.success) {
        console.log(`\n✓ Archived project "${result.project}"`);
        console.log(`  Sources affected: ${result.sources_affected}`);
        if (result.reason) console.log(`  Reason: ${result.reason}`);
        if (result.successor_project) console.log(`  Successor: ${result.successor_project}`);
        console.log(`  Synced: ${result.synced ? 'yes' : 'no'}`);
      } else {
        console.error(`\nFailed to archive: ${result.error}`);
        process.exit(1);
      }
    });

  // Delete project
  projectsCmd
    .command('delete')
    .description('Delete a project and all its documents')
    .argument('<name>', 'Project name to delete')
    .option('-d, --data-dir <dir>', 'Data directory', defaultDataDir)
    .option('--force', 'Skip confirmation')
    .action(async (projectName, options) => {
      const dataDir = options.dataDir;
      const dbPath = path.join(dataDir, 'lore.lance');

      if (!(await indexExists(dbPath))) {
        console.log('No index found. Run "lore sync" first.');
        process.exit(1);
      }

      // Get project stats first
      const { getProjectStats, getAllSources, deleteSource } = await import('../../core/vector-store.js');
      const projects = await getProjectStats(dbPath);
      const project = projects.find(p => p.project === projectName);

      if (!project) {
        console.error(`Project not found: ${projectName}`);
        process.exit(1);
      }

      if (!options.force) {
        const readline = await import('readline');
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });

        console.log(`\nThis will delete project "${projectName}" and all ${project.source_count} documents.`);
        const answer = await new Promise<string>((resolve) => {
          rl.question('Are you sure? (type "yes" to confirm) ', resolve);
        });
        rl.close();

        if (answer !== 'yes') {
          console.log('Cancelled.');
          return;
        }
      }

      // Get all sources in this project
      const sources = await getAllSources(dbPath, { project: projectName });

      // Delete each source
      const { rm } = await import('fs/promises');
      let deleted = 0;
      for (const source of sources) {
        await deleteSource(dbPath, source.id);

        // Delete from disk
        const sourcePath = path.join(dataDir, 'sources', source.id);
        try {
          await rm(sourcePath, { recursive: true });
        } catch {
          // File may not exist on disk
        }
        deleted++;
      }

      console.log(`\n✓ Deleted project "${projectName}"`);
      console.log(`  Documents deleted: ${deleted}`);
    });
}
