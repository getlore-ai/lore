/**
 * Auth Commands
 *
 * lore auth login  — interactive OTP flow
 * lore auth logout — clear session
 * lore auth whoami — show current user/status
 * lore setup       — guided wizard (config + login + init + first sync source)
 */

import type { Command } from 'commander';
import path from 'path';
import { colors, c } from '../colors.js';
import { getLogo } from '../logo.js';

// ============================================================================
// Readline helper
// ============================================================================

async function prompt(question: string, defaultValue?: string): Promise<string> {
  const readline = await import('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    const display = defaultValue ? `${question} [${defaultValue}]: ` : `${question}: `;
    rl.question(display, (answer) => {
      rl.close();
      resolve(answer.trim() || defaultValue || '');
    });
  });
}

// ============================================================================
// Command Registration
// ============================================================================

export function registerAuthCommands(program: Command): void {
  const authCmd = program
    .command('auth')
    .description('Authentication commands (login, logout, whoami)');

  // ── lore auth login ──────────────────────────────────────────────────────
  authCmd
    .command('login')
    .description('Sign in with email (OTP)')
    .option('-e, --email <email>', 'Email address')
    .option('--code <code>', 'OTP code (skip interactive prompt — use after --send-only)')
    .option('--send-only', 'Send OTP and exit without waiting for code')
    .action(async (options) => {
      const { sendOTP, verifyOTP, sessionFromMagicLink, waitForMagicLinkCallback, isAuthenticated } = await import('../../core/auth.js');

      // Check if already logged in
      if (await isAuthenticated()) {
        const { loadAuthSession } = await import('../../core/auth.js');
        const session = await loadAuthSession();
        console.log(c.success(`Already logged in as ${session?.user.email}`));
        console.log(c.dim('Run \'lore auth logout\' first to switch accounts.'));
        return;
      }

      const email = options.email || await prompt('Email');
      if (!email) {
        console.error(c.error('Email is required'));
        process.exit(1);
      }

      // Non-interactive: --code provided → verify directly (OTP must have been sent already)
      if (options.code) {
        const { session, error } = await verifyOTP(email, options.code);
        if (error || !session) {
          console.error(c.error(`Verification failed: ${error || 'Unknown error'}`));
          process.exit(1);
        }
        console.log(c.success(`Logged in as ${session.user.email}`));
        return;
      }

      // Send OTP
      console.log(c.dim(`Sending code to ${email}...`));
      const { error: sendError } = await sendOTP(email);
      if (sendError) {
        console.error(c.error(`Failed to send code: ${sendError}`));
        process.exit(1);
      }

      console.log(c.success(`OTP sent to ${email}`));

      // --send-only: exit after sending
      if (options.sendOnly) {
        console.log(c.dim('Re-run with --code <code> to complete login.'));
        return;
      }

      console.log(c.dim('Click the magic link in the email — it will sign you in automatically.'));
      console.log(c.dim('Or paste a 6-digit code if your email shows one.'));
      console.log('');
      console.log(c.dim('Waiting for magic link click...'));

      // Start the localhost callback server
      const callback = waitForMagicLinkCallback({
        onListening: () => {},
      });

      // Race: callback server catches the magic link, or user pastes a code/URL
      const readline = await import('readline');
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

      const manualInput = new Promise<string>((resolve) => {
        rl.question('Or paste code/URL here: ', (answer) => resolve(answer.trim()));
      });

      const result = await Promise.race([
        callback.promise.then(session => ({ type: 'callback' as const, session })),
        manualInput.then(input => ({ type: 'manual' as const, input })),
      ]);

      // Clear the readline prompt line before printing result
      rl.close();
      process.stdout.write('\x1b[1A\x1b[2K'); // Move up one line and clear it

      let session;
      let verifyError: string | undefined;

      if (result.type === 'callback' && result.session) {
        session = result.session;
      } else if (result.type === 'manual' && result.input) {
        callback.abort();
        const input = result.input;

        if (input.startsWith('http')) {
          const r = await sessionFromMagicLink(input);
          session = r.session;
          verifyError = r.error;
        } else {
          const r = await verifyOTP(email, input);
          session = r.session;
          verifyError = r.error;
        }
      } else {
        callback.abort();
        console.error(c.error('Login timed out. Try again with \'lore auth login\'.'));
        process.exit(1);
      }

      if (verifyError || !session) {
        console.error(c.error(`Verification failed: ${verifyError || 'Unknown error'}`));
        process.exit(1);
      }

      console.log(c.success(`Logged in as ${session.user.email}`));
    });

  // ── lore auth logout ─────────────────────────────────────────────────────
  authCmd
    .command('logout')
    .description('Sign out and clear session')
    .action(async () => {
      const { clearAuthSession } = await import('../../core/auth.js');
      const { resetDatabaseConnection } = await import('../../core/vector-store.js');

      await clearAuthSession();
      resetDatabaseConnection();

      console.log(c.success('Logged out.'));
    });

  // ── lore auth whoami ─────────────────────────────────────────────────────
  authCmd
    .command('whoami')
    .description('Show current authentication status')
    .action(async () => {
      const { getValidSession } = await import('../../core/auth.js');

      // Check for service key mode
      if (process.env.SUPABASE_SERVICE_KEY) {
        console.log(c.warning('Service key mode (SUPABASE_SERVICE_KEY set)'));
        console.log(c.dim('RLS is bypassed. All data is accessible.'));
        return;
      }

      const session = await getValidSession();
      if (!session) {
        console.log(c.dim('Not logged in. Run \'lore auth login\' to sign in.'));
        return;
      }

      console.log(`${c.bold('Email:')} ${session.user.email}`);
      console.log(`${c.bold('User ID:')} ${c.dim(session.user.id)}`);

      const expiresAt = new Date(session.expires_at * 1000);
      const now = new Date();
      if (expiresAt > now) {
        const minutes = Math.round((expiresAt.getTime() - now.getTime()) / 60000);
        console.log(`${c.bold('Session:')} ${c.success('active')} (expires in ${minutes}m)`);
      } else {
        console.log(`${c.bold('Session:')} ${c.warning('expired, will refresh on next use')}`);
      }
    });

  // ── lore setup ──────────────────────────────────────────────────────────
  program
    .command('setup')
    .description('Guided setup wizard (config, login, init)')
    .option('--openai-key <key>', 'OpenAI API key (skip prompt)')
    .option('--anthropic-key <key>', 'Anthropic API key (skip prompt)')
    .option('-e, --email <email>', 'Email address (skip prompt)')
    .option('--data-dir <dir>', 'Data directory path (skip prompt)')
    .option('--code <code>', 'OTP code (for non-interactive login)')
    .option('--skip-login', 'Skip the login step (use if already authenticated)')
    .option('--sync-path <path>', 'Sync source directory path (non-interactive)')
    .option('--sync-project <project>', 'Default project for sync source (non-interactive)')
    .option('--sync-name <name>', 'Name for sync source (non-interactive, defaults to project name)')
    .action(async (options) => {
      const { saveLoreConfig, getLoreConfigPath } = await import('../../core/config.js');
      const { sendOTP, verifyOTP, sessionFromMagicLink, isAuthenticated, loadAuthSession } = await import('../../core/auth.js');
      const { bridgeConfigToEnv } = await import('../../core/config.js');

      // Non-interactive mode: skip prompts when all key flags are provided
      const nonInteractive = !!(options.openaiKey && options.anthropicKey && options.email);

      console.log('');
      console.log(getLogo());
      console.log('');
      console.log(`  ${c.title('Setup Wizard')}`);
      console.log(`  ${c.dim('━'.repeat(12))}`);
      console.log('');

      // ── Preflight Checks ───────────────────────────────────────────
      console.log(c.bold('Preflight Checks\n'));

      const { checkGit } = await import('../../core/preflight.js');
      const gitCheck = checkGit();

      if (!gitCheck.installed) {
        console.log(`  ${c.warning('⚠')} git not installed`);
        console.log(`    ${c.dim('Cross-machine sync will use Lore Cloud. Install git for local version history.')}`);
        console.log('');
      } else {
        console.log(`  ${c.success('✓')} git ${gitCheck.version || '(unknown version)'}`);

        if (!gitCheck.configured) {
          console.log(`  ${c.warning('⚠')} git user not configured`);
          console.log(`    ${c.dim('Fix: git config --global user.email "you@example.com"')}`);
          console.log(`    ${c.dim('     git config --global user.name "Your Name"')}`);
        }
        console.log('');
      }

      // ── Step 1: Configuration ───────────────────────────────────────
      console.log(c.bold('Step 1: Configuration\n'));

      const { expandPath } = await import('../../sync/config.js');
      const defaultDataDir = process.env.LORE_DATA_DIR || '~/.lore';
      const dataDir = options.dataDir || await prompt('Data directory', defaultDataDir);
      const openaiApiKey = options.openaiKey || process.env.OPENAI_API_KEY || await prompt('OpenAI API Key (for embeddings)');
      const anthropicApiKey = options.anthropicKey || process.env.ANTHROPIC_API_KEY || await prompt('Anthropic API Key (for sync & research)');

      // Validate API keys before saving
      let openaiKeyValidated = false;
      let anthropicKeyValidated = false;

      if (openaiApiKey || anthropicApiKey) {
        const { validateOpenAIKey, validateAnthropicKey } = await import('../../core/preflight.js');

        const validations: Promise<void>[] = [];

        if (openaiApiKey) {
          validations.push(
            (async () => {
              process.stdout.write(c.dim('Validating OpenAI key... '));
              const result = await validateOpenAIKey(openaiApiKey);
              if (result.valid) {
                console.log(c.success('✓ valid'));
                openaiKeyValidated = true;
              } else {
                console.log(c.warning(`✗ ${result.error || 'invalid'}`));
                if (!nonInteractive) {
                  const cont = await prompt('Continue anyway? (y/n)', 'y');
                  if (cont.toLowerCase() !== 'y') process.exit(1);
                }
              }
            })()
          );
        }

        if (anthropicApiKey) {
          validations.push(
            (async () => {
              process.stdout.write(c.dim('Validating Anthropic key... '));
              const result = await validateAnthropicKey(anthropicApiKey);
              if (result.valid) {
                console.log(c.success('✓ valid'));
                anthropicKeyValidated = true;
              } else {
                console.log(c.warning(`✗ ${result.error || 'invalid'}`));
                if (!nonInteractive) {
                  const cont = await prompt('Continue anyway? (y/n)', 'y');
                  if (cont.toLowerCase() !== 'y') process.exit(1);
                }
              }
            })()
          );
        }

        // Run validations sequentially (stdout interleaving otherwise)
        for (const v of validations) await v;
        console.log('');
      }

      await saveLoreConfig({
        ...(dataDir ? { data_dir: expandPath(dataDir) } : {}),
        ...(openaiApiKey ? { openai_api_key: openaiApiKey } : {}),
        ...(anthropicApiKey ? { anthropic_api_key: anthropicApiKey } : {}),
      });

      console.log(c.success(`Config saved to ${getLoreConfigPath()}\n`));

      // Bridge new config values into process.env for subsequent steps
      await bridgeConfigToEnv();

      // ── Step 2: Login ──────────────────────────────────────────────────
      console.log(c.bold('Step 2: Login\n'));

      if (options.skipLogin) {
        console.log(c.dim('Skipped (--skip-login)\n'));
      } else if (await isAuthenticated()) {
        const session = await loadAuthSession();
        console.log(c.success(`Already logged in as ${session?.user.email}\n`));
      } else {
        const email = options.email || await prompt('Email');
        if (!email) {
          console.error(c.error('Email is required'));
          process.exit(1);
        }

        if (options.code) {
          // Non-interactive: --code provided → verify directly (OTP must have been sent already)
          const result = await verifyOTP(email, options.code);
          if (result.error || !result.session) {
            console.error(c.error(`Verification failed: ${result.error || 'Unknown error'}`));
            process.exit(1);
          }
          console.log(c.success(`Logged in as ${result.session.user.email}\n`));
        } else if (nonInteractive) {
          // Non-interactive without --code: send OTP and exit so agent can retrieve code
          console.log(c.dim(`Sending code to ${email}...`));
          const { error: sendError } = await sendOTP(email);
          if (sendError) {
            console.error(c.error(`Failed to send code: ${sendError}`));
            process.exit(1);
          }
          console.log(c.success(`OTP sent to ${email}`));
          console.log(c.dim('Re-run with --code <code> to complete setup.\n'));
          console.log(c.dim('Example:'));
          console.log(c.dim(`  lore setup --openai-key ... --anthropic-key ... --email ${email} --code <code>\n`));
          return; // Exit — config is saved, agent re-runs with --code
        } else {
          // Interactive: send OTP and prompt
          console.log(c.dim(`Sending code to ${email}...`));
          const { error: sendError } = await sendOTP(email);
          if (sendError) {
            console.error(c.error(`Failed to send code: ${sendError}`));
            process.exit(1);
          }

          console.log(c.success('Check your email!'));
          console.log(c.dim('You may receive a 6-digit code or a magic link URL.'));
          const response = await prompt('Paste the code or the full magic link URL');
          if (!response) {
            console.error(c.error('Code or magic link is required'));
            process.exit(1);
          }

          let session;
          let verifyError: string | undefined;

          if (response.startsWith('http')) {
            const result = await sessionFromMagicLink(response);
            session = result.session;
            verifyError = result.error;
          } else {
            const result = await verifyOTP(email, response);
            session = result.session;
            verifyError = result.error;
          }

          if (verifyError || !session) {
            console.error(c.error(`Verification failed: ${verifyError || 'Unknown error'}`));
            process.exit(1);
          }

          console.log(c.success(`Logged in as ${session.user.email}\n`));
        }
      }

      // ── Step 3: Data Repository ────────────────────────────────────────
      console.log(c.bold('Step 3: Data Repository\n'));

      const { existsSync } = await import('fs');
      const { mkdir: mkdirFs } = await import('fs/promises');
      const { initDataRepo, isGhAvailable, createGithubRepo, getGitRemoteUrl, isGitRepo } = await import('../../core/data-repo.js');
      const { getUserSetting, setUserSetting, SETTING_DATA_REPO_URL } = await import('../../core/user-settings.js');
      const { resetDatabaseConnection } = await import('../../core/vector-store.js');

      // Reset Supabase client so it picks up the fresh auth session from Step 2
      resetDatabaseConnection();

      const resolvedDataDir = expandPath(dataDir || '~/.lore');

      if (!gitCheck.installed) {
        // No git — just create data directory, skip all git operations
        if (!existsSync(resolvedDataDir)) {
          await mkdirFs(resolvedDataDir, { recursive: true });
          await mkdirFs(path.join(resolvedDataDir, 'sources'), { recursive: true });
          console.log(c.success(`Created data directory at ${resolvedDataDir}`));
          console.log(c.dim('Cross-machine sync uses Lore Cloud (no git required).\n'));
        } else {
          console.log(c.success(`Data directory exists at ${resolvedDataDir}\n`));
        }
      } else {
        // Git is available — full git-based setup
        const dirExists = existsSync(resolvedDataDir);
        const hasGitRemote = dirExists && isGitRepo(resolvedDataDir) && !!getGitRemoteUrl(resolvedDataDir);

        if (dirExists && hasGitRemote) {
          // Already fully set up
          const remoteUrl = getGitRemoteUrl(resolvedDataDir)!;
          console.log(c.success(`Data repo already set up at ${resolvedDataDir}`));
          console.log(c.dim(`Remote: ${remoteUrl}\n`));

          // Save URL to Supabase if not already saved
          try {
            const savedUrl = await getUserSetting(SETTING_DATA_REPO_URL);
            if (!savedUrl) {
              await setUserSetting(SETTING_DATA_REPO_URL, remoteUrl);
              console.log(c.dim('Saved repo URL to your account for cross-machine discovery.\n'));
            }
          } catch (err) {
            console.log(c.dim(`Note: Could not sync repo URL to account: ${err instanceof Error ? err.message : err}`));
          }
        } else if (!dirExists) {
          // Check Supabase for saved repo URL (Machine B scenario)
          let savedUrl: string | null = null;
          try {
            savedUrl = await getUserSetting(SETTING_DATA_REPO_URL);
          } catch (err) {
            console.log(c.dim(`Could not check for existing repo URL: ${err instanceof Error ? err.message : err}`));
          }

          if (savedUrl) {
            // Machine B: clone existing repo
            console.log(c.success(`Found your data repo URL: ${savedUrl}`));
            const cloneIt = nonInteractive ? 'y' : await prompt('Clone it to ' + resolvedDataDir + '? (y/n)', 'y');

            if (cloneIt.toLowerCase() === 'y') {
              try {
                const { execFileSync } = await import('child_process');
                execFileSync('git', ['clone', savedUrl, resolvedDataDir], { stdio: 'inherit' });
                console.log(c.success('Cloned successfully!\n'));
              } catch {
                console.log(c.warning('Clone failed. You can clone manually later.\n'));
              }
            } else {
              console.log(c.dim('Skipped. You can clone manually later.\n'));
            }
          } else {
            // Machine A: create fresh repo
            console.log(c.dim(`Creating data repository at ${resolvedDataDir}...\n`));
            const initResult = await initDataRepo(resolvedDataDir);
            if (initResult.gitInitialized) {
              console.log(c.success('Created data repository.\n'));
            } else {
              console.log(c.warning(`Created data directory, but git init failed: ${initResult.error}`));
              console.log(c.dim('You can initialize git manually later.\n'));
            }

            // Try to set up GitHub remote
            if (await isGhAvailable()) {
              const createRepo = nonInteractive ? 'y' : await prompt('Create a private GitHub repo for cross-machine sync? (y/n)', 'y');

              if (createRepo.toLowerCase() === 'y') {
                const repoName = nonInteractive ? 'lore-data' : await prompt('Repository name', 'lore-data');
                const url = await createGithubRepo(resolvedDataDir, repoName);

                if (url) {
                  console.log(c.success(`Created and pushed to ${url}\n`));
                  try {
                    await setUserSetting(SETTING_DATA_REPO_URL, url);
                    console.log(c.dim('Saved repo URL for cross-machine discovery.\n'));
                  } catch {
                    // Non-fatal
                  }
                } else {
                  console.log(c.warning('GitHub repo creation failed. You can set up a remote manually.\n'));
                }
              }
            } else if (!nonInteractive) {
              const remoteUrl = await prompt('Git remote URL for cross-machine sync (or press Enter to skip)');

              if (remoteUrl) {
                try {
                  const { execFileSync } = await import('child_process');
                  execFileSync('git', ['remote', 'add', 'origin', remoteUrl], { cwd: resolvedDataDir, stdio: 'pipe' });
                  execFileSync('git', ['push', '-u', 'origin', 'main'], { cwd: resolvedDataDir, stdio: 'pipe' });
                  console.log(c.success(`Remote added and pushed.\n`));
                  try {
                    await setUserSetting(SETTING_DATA_REPO_URL, remoteUrl);
                  } catch {
                    // Non-fatal
                  }
                } catch {
                  console.log(c.warning('Could not push to remote. You can push manually later.\n'));
                }
              } else {
                console.log(c.dim('Skipped remote setup. You can add one later with:\n'));
                console.log(c.dim(`  cd ${resolvedDataDir} && git remote add origin <url> && git push -u origin main\n`));
              }
            }
          }
        } else {
          // Dir exists but no git remote — check Supabase first, then offer setup
          console.log(c.dim(`Data directory exists at ${resolvedDataDir}, ensuring git is set up...\n`));
          const initResult2 = await initDataRepo(resolvedDataDir);
          if (!initResult2.gitInitialized) {
            console.log(c.warning(`Git init issue: ${initResult2.error || 'unknown'}\n`));
          }

          // Check Supabase for a saved repo URL before offering to create a new one
          let savedUrl: string | null = null;
          try {
            savedUrl = await getUserSetting(SETTING_DATA_REPO_URL);
          } catch (err) {
            console.log(c.dim(`Could not check for existing repo URL: ${err instanceof Error ? err.message : err}`));
          }

          if (savedUrl) {
            // Found existing repo — add as remote and pull
            console.log(c.success(`Found your data repo: ${savedUrl}`));
            const useIt = nonInteractive ? 'y' : await prompt('Add as remote and pull? (y/n)', 'y');

            if (useIt.toLowerCase() === 'y') {
              try {
                const { execFileSync } = await import('child_process');
                execFileSync('git', ['remote', 'add', 'origin', savedUrl], { cwd: resolvedDataDir, stdio: 'pipe' });
                execFileSync('git', ['fetch', 'origin'], { cwd: resolvedDataDir, stdio: 'pipe' });
                execFileSync('git', ['reset', '--hard', 'origin/main'], { cwd: resolvedDataDir, stdio: 'pipe' });
                console.log(c.success('Synced with existing repo!\n'));
              } catch {
                console.log(c.warning('Could not sync. You may need to set up the remote manually.\n'));
              }
            }
          } else if (await isGhAvailable()) {
            const createRepo = nonInteractive ? 'y' : await prompt('Create a private GitHub repo for cross-machine sync? (y/n)', 'y');

            if (createRepo.toLowerCase() === 'y') {
              const repoName = nonInteractive ? 'lore-data' : await prompt('Repository name', 'lore-data');
              const url = await createGithubRepo(resolvedDataDir, repoName);

              if (url) {
                console.log(c.success(`Created and pushed to ${url}\n`));
                try {
                  await setUserSetting(SETTING_DATA_REPO_URL, url);
                } catch {
                  // Non-fatal
                }
              } else {
                console.log(c.warning('GitHub repo creation failed.\n'));
              }
            }
          } else if (!nonInteractive) {
            const remoteUrl = await prompt('Git remote URL for cross-machine sync (or press Enter to skip)');

            if (remoteUrl) {
              try {
                const { execFileSync } = await import('child_process');
                execFileSync('git', ['remote', 'add', 'origin', remoteUrl], { cwd: resolvedDataDir, stdio: 'pipe' });
                execFileSync('git', ['push', '-u', 'origin', 'main'], { cwd: resolvedDataDir, stdio: 'pipe' });
                console.log(c.success(`Remote added and pushed.\n`));
                try {
                  await setUserSetting(SETTING_DATA_REPO_URL, remoteUrl);
                } catch {
                  // Non-fatal
                }
              } catch {
                console.log(c.warning('Could not push to remote. You can push manually later.\n'));
              }
            } else {
              console.log(c.dim('Skipped remote setup.\n'));
            }
          }
        }
      }

      // ── Step 4: Seed Document ─────────────────────────────────────────
      console.log(c.bold('Step 4: Welcome Document\n'));

      try {
        const { getAllSources } = await import('../../core/vector-store.js');
        const dbPath = path.join(resolvedDataDir, 'lore.lance');
        const existing = await getAllSources(dbPath, { limit: 1 });

        if (existing.length > 0) {
          console.log(c.success('You already have documents indexed — skipping welcome doc.\n'));
        } else {
          const { handleIngest } = await import('../../mcp/handlers/ingest.js');
          const { WELCOME_DOC_CONTENT } = await import('../../core/data-repo.js');

          console.log(c.dim('Indexing a welcome document so you can try search right away...'));
          await handleIngest(dbPath, resolvedDataDir, {
            content: WELCOME_DOC_CONTENT,
            title: 'Getting Started with Lore',
            project: 'lore',
            source_type: 'document',
            tags: ['getting-started', 'guide'],
          }, { autoPush: true, hookContext: { mode: 'cli' } });

          console.log(c.success('Indexed! Try: lore search "getting started"\n'));
        }
      } catch (err) {
        console.log(c.warning(`Skipped — ${err instanceof Error ? err.message : 'could not index welcome document'}`));
        console.log(c.dim('You can add documents later with lore sync\n'));
      }

      // ── Step 5: Sync Sources ──────────────────────────────────────────
      console.log(c.bold('Step 5: Sync Sources\n'));

      if (nonInteractive) {
        if (options.syncPath && options.syncProject) {
          const { addSyncSource } = await import('../../sync/config.js');
          const syncName = options.syncName || options.syncProject.charAt(0).toUpperCase() + options.syncProject.slice(1);
          try {
            await addSyncSource({
              name: syncName,
              path: expandPath(options.syncPath),
              glob: '**/*',
              project: options.syncProject,
              enabled: true,
            });
            console.log(c.success(`Added sync source "${syncName}" → ${options.syncPath}\n`));
          } catch (err) {
            console.log(c.warning(`Could not add sync source: ${err instanceof Error ? err.message : err}\n`));
          }
        } else {
          console.log(c.dim('Skipped (no --sync-path/--sync-project provided).\n'));
        }
      } else {
        console.log(c.dim('Sync sources are directories on your machine that Lore watches'));
        console.log(c.dim('for new files. When files appear or change, they\'re automatically'));
        console.log(c.dim('indexed into your knowledge base.\n'));
        console.log(c.dim('Supported formats: Markdown, JSON, JSONL, plain text, CSV,'));
        console.log(c.dim('HTML, XML, PDF, and images.\n'));

        let addMore = true;
        while (addMore) {
          const wantsSource = await prompt('Would you like to add a sync source? (y/n)', 'y');

          if (wantsSource.toLowerCase() !== 'y') {
            if (wantsSource.toLowerCase() === 'n') {
              console.log(c.dim('You can add sources anytime with: lore sync add\n'));
            }
            break;
          }

          const sourceName = await prompt('Name (e.g., "Meeting Notes")');
          const sourcePath = await prompt('Path (e.g., ~/Documents/notes)');
          const sourceProject = await prompt('Default project');

          if (!sourceName || !sourcePath || !sourceProject) {
            console.log(c.warning('Name, path, and project are all required. Skipping.\n'));
            break;
          }

          try {
            const { addSyncSource } = await import('../../sync/config.js');
            await addSyncSource({
              name: sourceName,
              path: expandPath(sourcePath),
              glob: '**/*',
              project: sourceProject,
              enabled: true,
            });
            console.log(c.success(`Added source "${sourceName}"`));
            console.log(c.dim(`  Path: ${sourcePath}`));
            console.log(c.dim(`  Glob: **/* (all supported files)\n`));
          } catch (err) {
            console.log(c.warning(`Could not add source: ${err instanceof Error ? err.message : err}\n`));
          }

          const another = await prompt('Add another source? (y/n)', 'n');
          addMore = another.toLowerCase() === 'y';
        }
      }

      // ── Step 6: Background Daemon ──────────────────────────────────────
      console.log(c.bold('Step 6: Background Daemon\n'));

      const startDaemon = nonInteractive ? 'y' : await prompt('Start background sync daemon? (y/n)', 'y');

      if (startDaemon.toLowerCase() === 'y') {
        try {
          const { startDaemonProcess } = await import('./sync.js');
          const result = await startDaemonProcess(resolvedDataDir);

          if (!result) {
            console.log(c.warning('Could not start daemon. You can start it later with: lore sync start\n'));
          } else if (result.alreadyRunning) {
            console.log(c.success(`Daemon already running (PID: ${result.pid})\n`));
          } else {
            console.log(c.success(`Daemon started (PID: ${result.pid}). Watches for new files and auto-indexes.\n`));
          }
          if (!gitCheck.installed) {
            console.log(c.dim('Note: git not installed — daemon will sync to Lore Cloud only.\n'));
          }
        } catch (err) {
          console.log(c.warning(`Could not start daemon: ${err instanceof Error ? err.message : err}`));
          console.log(c.dim('You can start it later with: lore sync start\n'));
        }
      } else {
        console.log(c.dim('You can start it later with: lore sync start\n'));
      }

      // ── Step 7: Agent Skills ──────────────────────────────────────────
      console.log(c.bold('Step 7: Agent Skills\n'));

      if (nonInteractive) {
        console.log(c.dim('Skipped in non-interactive mode.'));
        console.log(c.dim('Install later with: lore skills install <name>\n'));
      } else {
        console.log(c.dim('Lore works best when your AI agents know how to use it.'));
        console.log(c.dim('Install instruction files so agents automatically search and ingest into Lore.\n'));

        try {
          const { interactiveSkillInstall } = await import('./skills.js');
          const installed = await interactiveSkillInstall();

          if (installed.length > 0) {
            console.log(c.success(`\nInstalled skills: ${installed.join(', ')}\n`));
          } else {
            console.log(c.dim('\nSkipped. You can install later with: lore skills install <name>\n'));
          }
        } catch (err) {
          console.log(c.warning(`Could not install skills: ${err instanceof Error ? err.message : err}`));
          console.log(c.dim('You can install later with: lore skills install <name>\n'));
        }
      }

      // ── Health Check ──────────────────────────────────────────────────
      console.log(c.bold('Health Check\n'));

      // Config file
      try {
        const { loadLoreConfig } = await import('../../core/config.js');
        const cfg = await loadLoreConfig();
        if (cfg) {
          console.log(`  ${c.success('✓')} Configuration loaded`);
        } else {
          console.log(`  ${c.warning('⚠')} Configuration file missing`);
        }
      } catch {
        console.log(`  ${c.warning('⚠')} Could not load configuration`);
      }

      // Auth session
      if (!options.skipLogin) {
        try {
          const { getValidSession } = await import('../../core/auth.js');
          const session = await getValidSession();
          if (session) {
            console.log(`  ${c.success('✓')} Authenticated as ${session.user.email}`);
          } else {
            console.log(`  ${c.warning('⚠')} Not authenticated`);
          }
        } catch {
          console.log(`  ${c.warning('⚠')} Could not verify auth session`);
        }
      }

      // Supabase connection
      try {
        const { getSupabase } = await import('../../core/vector-store.js');
        const db = await getSupabase();
        const { error } = await db.from('sources').select('id').limit(1);
        if (!error) {
          console.log(`  ${c.success('✓')} Database connected`);
        } else {
          console.log(`  ${c.warning('⚠')} Database query failed: ${error.message}`);
        }
      } catch {
        console.log(`  ${c.warning('⚠')} Could not connect to database`);
      }

      // Data directory
      if (existsSync(resolvedDataDir)) {
        const gitOk = isGitRepo(resolvedDataDir);
        console.log(`  ${c.success('✓')} Data repo at ${resolvedDataDir}${gitOk ? '' : ' (no git)'}`);
      } else {
        console.log(`  ${c.warning('⚠')} Data directory not found at ${resolvedDataDir}`);
      }

      // API keys (skip re-validation if already validated in Step 1)
      if (openaiKeyValidated) {
        console.log(`  ${c.success('✓')} OpenAI API key valid`);
      } else if (openaiApiKey) {
        console.log(`  ${c.warning('⚠')} OpenAI API key not validated`);
      }

      if (anthropicKeyValidated) {
        console.log(`  ${c.success('✓')} Anthropic API key valid`);
      } else if (anthropicApiKey) {
        console.log(`  ${c.warning('⚠')} Anthropic API key not validated`);
      }

      console.log('');

      // ── Done ───────────────────────────────────────────────────────────
      console.log(c.title('Setup complete!\n'));
      console.log('Try these commands:');
      console.log(c.list('lore search "getting started"  — search your knowledge base'));
      console.log(c.list('lore browse                    — interactive terminal browser'));
      console.log(c.list('lore sync add                  — add a sync source directory'));
      console.log(c.list('lore sync                      — sync documents now'));
      console.log(c.list('lore skills list               — see available agent skills'));
      console.log('');
    });
}
