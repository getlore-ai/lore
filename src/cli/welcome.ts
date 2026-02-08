/**
 * Welcome Screen
 *
 * Shown when `lore` is run with no command.
 * Shows every command, categorized. This IS the help.
 */

import { c } from './colors.js';
import { getLogo } from './logo.js';

export function showWelcomeScreen(): void {
  console.log('');
  console.log(getLogo());
  console.log('');
  console.log(`  ${c.bold('Setup:')}`);
  console.log(`  ${c.dim('•')} lore setup              ${c.dim('— guided first-time setup')}`);
  console.log(`  ${c.dim('•')} lore auth login         ${c.dim('— sign in with email')}`);
  console.log(`  ${c.dim('•')} lore auth logout        ${c.dim('— sign out')}`);
  console.log(`  ${c.dim('•')} lore auth whoami        ${c.dim('— check login status')}`);
  console.log('');
  console.log(`  ${c.bold('Search & Research:')}`);
  console.log(`  ${c.dim('•')} lore search "query"     ${c.dim('— semantic + keyword search')}`);
  console.log(`  ${c.dim('•')} lore research "query"   ${c.dim('— AI-powered deep research')}`);
  console.log(`  ${c.dim('•')} lore ask "question"     ${c.dim('— quick question answering')}`);
  console.log(`  ${c.dim('•')} lore browse             ${c.dim('— interactive terminal browser')}`);
  console.log('');
  console.log(`  ${c.bold('Content:')}`);
  console.log(`  ${c.dim('•')} lore ingest             ${c.dim('— add content (CLI, pipe, or file)')}`);
  console.log(`  ${c.dim('•')} lore sync               ${c.dim('— sync all sources now')}`);
  console.log(`  ${c.dim('•')} lore sync add           ${c.dim('— add a source directory')}`);
  console.log(`  ${c.dim('•')} lore sync list          ${c.dim('— show configured sources')}`);
  console.log(`  ${c.dim('•')} lore sync enable <name> ${c.dim('— enable a source')}`);
  console.log(`  ${c.dim('•')} lore sync disable <name>${c.dim(' — disable')}`);
  console.log(`  ${c.dim('•')} lore sync remove <name> ${c.dim('— remove')}`);
  console.log('');
  console.log(`  ${c.bold('Background Sync:')}`);
  console.log(`  ${c.dim('•')} lore sync start         ${c.dim('— start daemon')}`);
  console.log(`  ${c.dim('•')} lore sync stop          ${c.dim('— stop daemon')}`);
  console.log(`  ${c.dim('•')} lore sync restart       ${c.dim('— restart daemon')}`);
  console.log(`  ${c.dim('•')} lore sync status        ${c.dim('— daemon status')}`);
  console.log(`  ${c.dim('•')} lore sync logs          ${c.dim('— view daemon logs')}`);
  console.log(`  ${c.dim('•')} lore sync watch         ${c.dim('— watch in foreground')}`);
  console.log('');
  console.log(`  ${c.bold('Documents & Projects:')}`);
  console.log(`  ${c.dim('•')} lore docs list          ${c.dim('— list indexed documents')}`);
  console.log(`  ${c.dim('•')} lore docs get <id>      ${c.dim('— view a document')}`);
  console.log(`  ${c.dim('•')} lore projects           ${c.dim('— list projects')}`);
  console.log(`  ${c.dim('•')} lore projects archive   ${c.dim('— archive a project')}`);
  console.log('');
  console.log(`  ${c.bold('System:')}`);
  console.log(`  ${c.dim('•')} lore update             ${c.dim('— check for and install updates')}`);
  console.log(`  ${c.dim('•')} lore skills install     ${c.dim('— install agent integrations')}`);
  console.log(`  ${c.dim('•')} lore skills list        ${c.dim('— available integrations')}`);
  console.log(`  ${c.dim('•')} lore mcp                ${c.dim('— start MCP server')}`);
  console.log(`  ${c.dim('•')} lore init               ${c.dim('— initialize data repository')}`);
  console.log('');
  console.log(c.dim(`  Run 'lore <command> --help' for options and flags.`));
  console.log('');
}
