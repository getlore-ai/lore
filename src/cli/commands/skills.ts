/**
 * Skills Command
 *
 * Install Lore agent instruction files into the correct locations
 * for each supported agent platform, using native plugin/extension formats.
 *
 * Each platform gets:
 * 1. MCP server configuration (so Lore auto-starts)
 * 2. Instruction/skill files (so the agent knows how to use Lore)
 *
 * lore skills list                    — show available skills
 * lore skills install claude-code     — install Claude Code plugin (MCP + skill)
 * lore skills install gemini          — install Gemini CLI extension (MCP + GEMINI.md)
 * lore skills install codex           — install Codex CLI skill (MCP + SKILL.md)
 * lore skills install openclaw        — install OpenClaw skill (SKILL.md)
 * lore skills install generic         — print generic instructions to stdout
 */

import type { Command } from 'commander';
import {
  existsSync,
  readFileSync,
  mkdirSync,
  writeFileSync,
  appendFileSync,
  cpSync,
} from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { c } from '../colors.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Path Resolution ─────────────────────────────────────────────────────

function packageRoot(): string {
  return path.resolve(__dirname, '..', '..', '..');
}

function pluginsDir(): string {
  const dir = path.join(packageRoot(), 'plugins');
  if (existsSync(dir)) return dir;
  throw new Error(`Plugins directory not found at ${dir}`);
}

function skillsDir(): string {
  const dir = path.join(packageRoot(), 'skills');
  if (existsSync(dir)) return dir;
  throw new Error(`Skills directory not found at ${dir}`);
}

function homeDir(): string {
  return process.env.HOME || process.env.USERPROFILE || '~';
}

const LORE_MARKER = '# Lore Knowledge Base';

const AVAILABLE_SKILLS = [
  {
    name: 'claude-code',
    description: 'Claude Code plugin (MCP server + skill)',
    native: '/plugin install — from marketplace or local',
  },
  {
    name: 'gemini',
    description: 'Gemini CLI extension (MCP server + context)',
    native: 'gemini extensions install <repo>',
  },
  {
    name: 'codex',
    description: 'Codex CLI skill (MCP + SKILL.md)',
    native: '$skill-installer inside Codex',
  },
  {
    name: 'openclaw',
    description: 'OpenClaw skill (SKILL.md)',
    native: 'clawhub install lore',
  },
  {
    name: 'generic',
    description: 'Platform-agnostic instructions (stdout)',
    native: 'N/A',
  },
];

// ── Helpers ─────────────────────────────────────────────────────────────

/**
 * Merge Lore MCP server config into a project's .mcp.json.
 * Creates the file if it doesn't exist.
 */
function mergeMcpJson(targetPath: string): { added: boolean; path: string } {
  const loreServer = {
    command: 'npx',
    args: ['-y', '@getlore/cli', 'mcp'],
  };

  let config: Record<string, unknown> = { mcpServers: {} };

  if (existsSync(targetPath)) {
    try {
      config = JSON.parse(readFileSync(targetPath, 'utf-8'));
    } catch {
      // Corrupted file — overwrite
    }
  }

  const servers = (config.mcpServers || config) as Record<string, unknown>;
  if (servers.lore) {
    return { added: false, path: targetPath };
  }

  servers.lore = loreServer;
  if (!config.mcpServers) {
    config = { mcpServers: servers };
  }

  mkdirSync(path.dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, JSON.stringify(config, null, 2) + '\n');
  return { added: true, path: targetPath };
}

/**
 * Append content to a file if the marker isn't already present.
 */
function appendIfMissing(filepath: string, content: string): 'created' | 'appended' | 'exists' {
  mkdirSync(path.dirname(filepath), { recursive: true });

  if (existsSync(filepath)) {
    const existing = readFileSync(filepath, 'utf-8');
    if (existing.includes(LORE_MARKER)) return 'exists';
    appendFileSync(filepath, '\n\n' + content);
    return 'appended';
  }
  writeFileSync(filepath, content);
  return 'created';
}

/**
 * Copy a directory recursively.
 */
function copyDir(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true });
  cpSync(src, dest, { recursive: true });
}

// ── Installers ──────────────────────────────────────────────────────────

function installClaudeCode(options: { global?: boolean }): string {
  const lines: string[] = [];
  const pluginSrc = path.join(pluginsDir(), 'claude-code');

  if (options.global) {
    // Global: install plugin to ~/.lore/plugins/claude-code/ + add MCP to ~/.claude.json
    const dest = path.join(homeDir(), '.lore', 'plugins', 'claude-code');
    copyDir(pluginSrc, dest);
    lines.push(`${c.success('Installed')} plugin to ${c.file(dest)}`);

    // Try to add MCP to user-level config
    const claudeJsonPath = path.join(homeDir(), '.claude.json');
    const mcp = mergeMcpJson(claudeJsonPath);
    if (mcp.added) {
      lines.push(`${c.success('Added')} Lore MCP server to ${c.file(mcp.path)}`);
    } else {
      lines.push(`${c.dim('MCP server already configured in')} ${c.file(mcp.path)}`);
    }

    lines.push('');
    lines.push(c.dim('To activate the plugin in Claude Code, run:'));
    lines.push(c.bold(`  claude --plugin-dir ${dest}`));
  } else {
    // Project-level: add MCP to .mcp.json + install skill to .claude/rules/
    const mcpJsonPath = path.join(process.cwd(), '.mcp.json');
    const mcp = mergeMcpJson(mcpJsonPath);
    if (mcp.added) {
      lines.push(`${c.success('Added')} Lore MCP server to ${c.file(mcp.path)}`);
    } else {
      lines.push(`${c.dim('MCP server already configured in')} ${c.file(mcp.path)}`);
    }

    // Install skill as a rule file
    const skillContent = readFileSync(
      path.join(pluginSrc, 'skills', 'lore', 'SKILL.md'),
      'utf-8'
    );
    // Strip YAML frontmatter for rules file
    const body = skillContent.replace(/^---[\s\S]*?---\n*/, '');
    const rulesPath = path.join(process.cwd(), '.claude', 'rules', 'lore.md');
    const result = appendIfMissing(rulesPath, body);
    if (result === 'exists') {
      lines.push(`${c.dim('Instructions already in')} ${c.file(rulesPath)}`);
    } else {
      lines.push(`${c.success(result === 'created' ? 'Created' : 'Appended to')} ${c.file(rulesPath)}`);
    }

    // Also copy the full plugin for reference
    const pluginDest = path.join(homeDir(), '.lore', 'plugins', 'claude-code');
    copyDir(pluginSrc, pluginDest);

    lines.push('');
    lines.push(c.dim('Claude Code will auto-start the Lore MCP server for this project.'));
    lines.push(c.dim('For the full plugin experience (marketplace distribution):'));
    lines.push(c.bold(`  claude --plugin-dir ${pluginDest}`));
  }

  return lines.join('\n');
}

function installGemini(options: { global?: boolean }): string {
  const lines: string[] = [];
  const extensionSrc = path.join(pluginsDir(), 'gemini');

  if (options.global) {
    // Install extension to ~/.lore/plugins/gemini/ and add context to ~/.gemini/GEMINI.md
    const dest = path.join(homeDir(), '.lore', 'plugins', 'gemini');
    copyDir(extensionSrc, dest);
    lines.push(`${c.success('Installed')} extension to ${c.file(dest)}`);

    const geminiMd = readFileSync(path.join(extensionSrc, 'GEMINI.md'), 'utf-8');
    const globalPath = path.join(homeDir(), '.gemini', 'GEMINI.md');
    const result = appendIfMissing(globalPath, geminiMd);
    if (result === 'exists') {
      lines.push(`${c.dim('Instructions already in')} ${c.file(globalPath)}`);
    } else {
      lines.push(`${c.success(result === 'created' ? 'Created' : 'Appended to')} ${c.file(globalPath)}`);
    }

    lines.push('');
    lines.push(c.dim('For native extension install (auto-starts MCP server):'));
    lines.push(c.bold(`  gemini extensions install ${dest}`));
  } else {
    // Project-level: install extension locally
    const dest = path.join(homeDir(), '.lore', 'plugins', 'gemini');
    copyDir(extensionSrc, dest);

    const geminiMd = readFileSync(path.join(extensionSrc, 'GEMINI.md'), 'utf-8');
    const projectPath = path.join(process.cwd(), 'GEMINI.md');
    const result = appendIfMissing(projectPath, geminiMd);
    if (result === 'exists') {
      lines.push(`${c.dim('Instructions already in')} ${c.file(projectPath)}`);
    } else {
      lines.push(`${c.success(result === 'created' ? 'Created' : 'Appended to')} ${c.file(projectPath)}`);
    }

    lines.push('');
    lines.push(c.dim('For native extension install (auto-starts MCP server):'));
    lines.push(c.bold(`  gemini extensions install ${dest}`));
  }

  return lines.join('\n');
}

function installCodex(options: { global?: boolean }): string {
  const lines: string[] = [];
  const skillSrc = path.join(pluginsDir(), 'codex');

  // Install skill to ~/.codex/skills/lore/ (or ~/.agents/skills/lore/)
  const codexSkillsDir = path.join(homeDir(), '.codex', 'skills', 'lore');
  const agentsSkillsDir = path.join(homeDir(), '.agents', 'skills', 'lore');

  // Prefer ~/.codex/skills/ if ~/.codex/ exists, otherwise ~/.agents/skills/
  const codexDir = path.join(homeDir(), '.codex');
  const targetDir = existsSync(codexDir) ? codexSkillsDir : agentsSkillsDir;

  copyDir(skillSrc, targetDir);
  lines.push(`${c.success('Installed')} skill to ${c.file(targetDir)}`);

  if (options.global) {
    // Add instructions to global AGENTS.md
    const content = readFileSync(path.join(skillSrc, 'SKILL.md'), 'utf-8');
    const body = content.replace(/^---[\s\S]*?---\n*/, '');
    const globalPath = path.join(homeDir(), '.codex', 'AGENTS.md');
    const result = appendIfMissing(globalPath, body);
    if (result === 'exists') {
      lines.push(`${c.dim('Instructions already in')} ${c.file(globalPath)}`);
    } else {
      lines.push(`${c.success(result === 'created' ? 'Created' : 'Appended to')} ${c.file(globalPath)}`);
    }
  } else {
    // Add instructions to project AGENTS.md
    const content = readFileSync(path.join(skillSrc, 'SKILL.md'), 'utf-8');
    const body = content.replace(/^---[\s\S]*?---\n*/, '');
    const projectPath = path.join(process.cwd(), 'AGENTS.md');
    const result = appendIfMissing(projectPath, body);
    if (result === 'exists') {
      lines.push(`${c.dim('Instructions already in')} ${c.file(projectPath)}`);
    } else {
      lines.push(`${c.success(result === 'created' ? 'Created' : 'Appended to')} ${c.file(projectPath)}`);
    }
  }

  lines.push('');
  lines.push(c.dim('Restart Codex to pick up the new skill.'));
  lines.push(c.dim('Configure MCP server in Codex:'));
  lines.push(c.bold('  codex mcp add lore -- npx -y @getlore/cli mcp'));

  return lines.join('\n');
}

function installOpenClaw(): string {
  const lines: string[] = [];
  const content = readFileSync(path.join(skillsDir(), 'openclaw.md'), 'utf-8');

  const skillDir = path.join(homeDir(), '.openclaw', 'skills', 'lore');
  const skillPath = path.join(skillDir, 'SKILL.md');

  mkdirSync(skillDir, { recursive: true });

  if (existsSync(skillPath)) {
    const existing = readFileSync(skillPath, 'utf-8');
    if (existing.includes('name: lore')) {
      lines.push(`${c.dim('Already installed at')} ${c.file(skillPath)}`);
      return lines.join('\n');
    }
  }

  writeFileSync(skillPath, content);
  lines.push(`${c.success('Created')} ${c.file(skillPath)}`);
  lines.push(c.dim('OpenClaw will auto-discover this skill.'));

  return lines.join('\n');
}

function showGeneric(): string {
  return readFileSync(path.join(skillsDir(), 'generic-agent.md'), 'utf-8');
}

// ── Command Registration ────────────────────────────────────────────────

export function registerSkillsCommand(program: Command): void {
  const skillsCmd = program
    .command('skills')
    .description('Install Lore into your AI coding agents');

  // lore skills list
  skillsCmd
    .command('list')
    .description('List available agent integrations')
    .action(() => {
      console.log(`\n${c.title('Available Integrations')}\n`);
      for (const skill of AVAILABLE_SKILLS) {
        console.log(`  ${c.bold(skill.name.padEnd(14))} ${c.dim(skill.description)}`);
      }
      console.log(`\n${c.dim('Install with: lore skills install <name>')}`);
      console.log(c.dim('Add --global to install user-wide instead of project-scoped\n'));
    });

  // lore skills install <name>
  skillsCmd
    .command('install <name>')
    .description('Install Lore integration for a specific agent platform')
    .option('-g, --global', 'Install globally instead of to current project')
    .action((name: string, options: { global?: boolean }) => {
      try {
        let result: string;

        switch (name) {
          case 'claude-code':
          case 'claude':
            result = installClaudeCode(options);
            break;
          case 'gemini':
            result = installGemini(options);
            break;
          case 'codex':
            result = installCodex(options);
            break;
          case 'openclaw':
            result = installOpenClaw();
            break;
          case 'generic':
            result = showGeneric();
            break;
          default:
            console.error(c.error(`Unknown agent: ${name}`));
            console.log(c.dim(`Available: ${AVAILABLE_SKILLS.map((s) => s.name).join(', ')}`));
            process.exit(1);
        }

        console.log(result);
      } catch (error) {
        console.error(c.error(`Failed to install: ${error instanceof Error ? error.message : error}`));
        process.exit(1);
      }
    });

  // lore skills show <name>
  skillsCmd
    .command('show <name>')
    .description('Print the contents of an integration\'s instruction file')
    .action((name: string) => {
      try {
        let content: string;
        switch (name) {
          case 'claude-code':
          case 'claude':
            content = readFileSync(
              path.join(pluginsDir(), 'claude-code', 'skills', 'lore', 'SKILL.md'),
              'utf-8'
            );
            break;
          case 'gemini':
            content = readFileSync(
              path.join(pluginsDir(), 'gemini', 'GEMINI.md'),
              'utf-8'
            );
            break;
          case 'codex':
            content = readFileSync(
              path.join(pluginsDir(), 'codex', 'SKILL.md'),
              'utf-8'
            );
            break;
          case 'openclaw':
            content = readFileSync(path.join(skillsDir(), 'openclaw.md'), 'utf-8');
            break;
          case 'generic':
            content = readFileSync(path.join(skillsDir(), 'generic-agent.md'), 'utf-8');
            break;
          default:
            console.error(c.error(`Unknown agent: ${name}`));
            process.exit(1);
        }
        console.log(content);
      } catch (error) {
        console.error(c.error(`Failed to read: ${error instanceof Error ? error.message : error}`));
        process.exit(1);
      }
    });
}

/**
 * Interactive skill installation — used by the setup wizard.
 * Returns a summary of what was installed.
 */
export async function interactiveSkillInstall(): Promise<string[]> {
  const readline = await import('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const ask = (question: string, defaultValue?: string): Promise<string> =>
    new Promise((resolve) => {
      const display = defaultValue ? `${question} [${defaultValue}]: ` : `${question}: `;
      rl.question(display, (answer) => resolve(answer.trim() || defaultValue || ''));
    });

  const installed: string[] = [];

  console.log(c.dim('Which AI coding agents do you use? Lore will configure the MCP server'));
  console.log(c.dim('and install instructions so agents know how to use your knowledge base.\n'));
  console.log(`  ${c.bold('1.')} Claude Code  ${c.dim('— plugin with MCP auto-start')}`);
  console.log(`  ${c.bold('2.')} Gemini CLI   ${c.dim('— extension with MCP auto-start')}`);
  console.log(`  ${c.bold('3.')} Codex CLI    ${c.dim('— skill + MCP config')}`);
  console.log(`  ${c.bold('4.')} OpenClaw     ${c.dim('— SKILL.md auto-discovery')}`);
  console.log(`  ${c.bold('5.')} All`);
  console.log(`  ${c.bold('6.')} Skip\n`);

  const choice = await ask('Choose (comma-separated for multiple, e.g. 1,2)', '1');
  rl.close();

  const choices = choice.split(',').map((s) => s.trim().toLowerCase());

  if (choices.includes('6') || choices.includes('skip')) {
    return installed;
  }

  const all = choices.includes('5') || choices.includes('all');

  if (all || choices.includes('1') || choices.includes('claude-code') || choices.includes('claude')) {
    try {
      console.log('');
      console.log(c.bold('Claude Code:'));
      console.log(installClaudeCode({ global: false }));
      installed.push('claude-code');
    } catch (error) {
      console.log(c.warning(`Claude Code: ${error instanceof Error ? error.message : error}`));
    }
  }

  if (all || choices.includes('2') || choices.includes('gemini')) {
    try {
      console.log('');
      console.log(c.bold('Gemini CLI:'));
      console.log(installGemini({ global: false }));
      installed.push('gemini');
    } catch (error) {
      console.log(c.warning(`Gemini: ${error instanceof Error ? error.message : error}`));
    }
  }

  if (all || choices.includes('3') || choices.includes('codex')) {
    try {
      console.log('');
      console.log(c.bold('Codex CLI:'));
      console.log(installCodex({ global: false }));
      installed.push('codex');
    } catch (error) {
      console.log(c.warning(`Codex: ${error instanceof Error ? error.message : error}`));
    }
  }

  if (all || choices.includes('4') || choices.includes('openclaw')) {
    try {
      console.log('');
      console.log(c.bold('OpenClaw:'));
      console.log(installOpenClaw());
      installed.push('openclaw');
    } catch (error) {
      console.log(c.warning(`OpenClaw: ${error instanceof Error ? error.message : error}`));
    }
  }

  return installed;
}
