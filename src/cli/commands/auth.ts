/**
 * Auth Commands
 *
 * lore login  — interactive OTP flow
 * lore logout — clear session
 * lore whoami — show current user/status
 * lore setup  — guided wizard (config + login + init + first sync source)
 */

import type { Command } from 'commander';
import { colors, c } from '../colors.js';

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
  // ── lore login ──────────────────────────────────────────────────────────
  program
    .command('login')
    .description('Sign in with email (OTP)')
    .option('-e, --email <email>', 'Email address')
    .action(async (options) => {
      const { sendOTP, verifyOTP, sessionFromMagicLink, waitForMagicLinkCallback, isAuthenticated } = await import('../../core/auth.js');

      // Check if already logged in
      if (await isAuthenticated()) {
        const { loadAuthSession } = await import('../../core/auth.js');
        const session = await loadAuthSession();
        console.log(c.success(`Already logged in as ${session?.user.email}`));
        console.log(c.dim('Run \'lore logout\' first to switch accounts.'));
        return;
      }

      const email = options.email || await prompt('Email');
      if (!email) {
        console.error(c.error('Email is required'));
        process.exit(1);
      }

      // Start the localhost callback server before sending the OTP
      // so it's ready when the user clicks the magic link
      const callback = waitForMagicLinkCallback({
        onListening: () => {
          // Server is ready — now send the OTP
        },
      });

      console.log(c.dim(`Sending code to ${email}...`));
      const { error: sendError } = await sendOTP(email);
      if (sendError) {
        callback.abort();
        console.error(c.error(`Failed to send code: ${sendError}`));
        process.exit(1);
      }

      console.log(c.success('Check your email!'));
      console.log(c.dim('Click the magic link in the email — it will sign you in automatically.'));
      console.log(c.dim('Or paste a 6-digit code if your email shows one.'));
      console.log('');
      console.log(c.dim('Waiting for magic link click...'));

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
        console.error(c.error('Login timed out. Try again with \'lore login\'.'));
        process.exit(1);
      }

      if (verifyError || !session) {
        console.error(c.error(`Verification failed: ${verifyError || 'Unknown error'}`));
        process.exit(1);
      }

      console.log(c.success(`Logged in as ${session.user.email}`));
    });

  // ── lore logout ─────────────────────────────────────────────────────────
  program
    .command('logout')
    .description('Sign out and clear session')
    .action(async () => {
      const { clearAuthSession } = await import('../../core/auth.js');
      const { resetDatabaseConnection } = await import('../../core/vector-store.js');

      await clearAuthSession();
      resetDatabaseConnection();

      console.log(c.success('Logged out.'));
    });

  // ── lore whoami ─────────────────────────────────────────────────────────
  program
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
        console.log(c.dim('Not logged in. Run \'lore login\' to sign in.'));
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
    .action(async () => {
      const { saveLoreConfig, getLoreConfigPath } = await import('../../core/config.js');
      const { sendOTP, verifyOTP, sessionFromMagicLink, isAuthenticated, loadAuthSession } = await import('../../core/auth.js');
      const { bridgeConfigToEnv } = await import('../../core/config.js');

      console.log(`\n${c.title('Lore Setup Wizard')}`);
      console.log(`${c.dim('=')}`.repeat(40) + '\n');

      // ── Step 1: Configuration ───────────────────────────────────────
      console.log(c.bold('Step 1: Configuration\n'));

      const { expandPath } = await import('../../sync/config.js');
      const defaultDataDir = process.env.LORE_DATA_DIR || '~/.lore';
      const dataDir = await prompt('Data directory', defaultDataDir);
      const openaiApiKey = await prompt('OpenAI API Key (for embeddings)');
      const anthropicApiKey = await prompt('Anthropic API Key (for sync & research)');

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

      if (await isAuthenticated()) {
        const session = await loadAuthSession();
        console.log(c.success(`Already logged in as ${session?.user.email}\n`));
      } else {
        const email = await prompt('Email');
        if (!email) {
          console.error(c.error('Email is required'));
          process.exit(1);
        }

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

      // ── Step 3: Data Repository ────────────────────────────────────────
      console.log(c.bold('Step 3: Data Repository\n'));

      const { existsSync } = await import('fs');
      const { initDataRepo, isGhAvailable, createGithubRepo, getGitRemoteUrl, isGitRepo } = await import('../../core/data-repo.js');
      const { getUserSetting, setUserSetting, SETTING_DATA_REPO_URL } = await import('../../core/user-settings.js');

      const resolvedDataDir = expandPath(dataDir || '~/.lore');

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
        } catch {
          // Non-fatal — user_settings table may not exist yet
        }
      } else if (!dirExists) {
        // Check Supabase for saved repo URL (Machine B scenario)
        let savedUrl: string | null = null;
        try {
          savedUrl = await getUserSetting(SETTING_DATA_REPO_URL);
        } catch {
          // Non-fatal
        }

        if (savedUrl) {
          // Machine B: clone existing repo
          console.log(c.success(`Found your data repo URL: ${savedUrl}`));
          const cloneIt = await prompt('Clone it to ' + resolvedDataDir + '? (y/n)', 'y');

          if (cloneIt.toLowerCase() === 'y') {
            try {
              const { execSync } = await import('child_process');
              execSync(`git clone ${savedUrl} ${resolvedDataDir}`, { stdio: 'inherit' });
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
          await initDataRepo(resolvedDataDir);
          console.log(c.success('Created data repository.\n'));

          // Try to set up GitHub remote
          if (await isGhAvailable()) {
            const createRepo = await prompt('Create a private GitHub repo for cross-machine sync? (y/n)', 'y');

            if (createRepo.toLowerCase() === 'y') {
              const repoName = await prompt('Repository name', 'lore-data');
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
          } else {
            const remoteUrl = await prompt('Git remote URL for cross-machine sync (or press Enter to skip)');

            if (remoteUrl) {
              try {
                const { execSync } = await import('child_process');
                execSync(`git remote add origin ${remoteUrl}`, { cwd: resolvedDataDir, stdio: 'pipe' });
                execSync('git push -u origin main', { cwd: resolvedDataDir, stdio: 'pipe' });
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
        // Dir exists but no git remote — init and offer remote setup
        console.log(c.dim(`Data directory exists at ${resolvedDataDir}, ensuring git is set up...\n`));
        await initDataRepo(resolvedDataDir);

        if (await isGhAvailable()) {
          const createRepo = await prompt('Create a private GitHub repo for cross-machine sync? (y/n)', 'y');

          if (createRepo.toLowerCase() === 'y') {
            const repoName = await prompt('Repository name', 'lore-data');
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
        } else {
          const remoteUrl = await prompt('Git remote URL for cross-machine sync (or press Enter to skip)');

          if (remoteUrl) {
            try {
              const { execSync } = await import('child_process');
              execSync(`git remote add origin ${remoteUrl}`, { cwd: resolvedDataDir, stdio: 'pipe' });
              execSync('git push -u origin main', { cwd: resolvedDataDir, stdio: 'pipe' });
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

      // ── Done ───────────────────────────────────────────────────────────
      console.log(c.title('Setup complete!'));
      console.log(c.dim('Next steps:'));
      console.log(c.list('lore sync sources add — add a sync source'));
      console.log(c.list('lore sync — sync your documents'));
      console.log(c.list('lore search "query" — search your knowledge base'));
      console.log('');
    });
}
