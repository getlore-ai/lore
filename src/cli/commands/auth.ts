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
      const { saveLoreConfig, getLoreConfigPath, loadLoreConfig } = await import('../../core/config.js');
      const { sendOTP, verifyOTP, sessionFromMagicLink, isAuthenticated, loadAuthSession } = await import('../../core/auth.js');
      const { bridgeConfigToEnv } = await import('../../core/config.js');

      console.log(`\n${c.title('Lore Setup Wizard')}`);
      console.log(`${c.dim('=')}`.repeat(40) + '\n');

      // ── Step 1: API Keys ─────────────────────────────────────────────
      console.log(c.bold('Step 1: API Keys\n'));

      const existing = await loadLoreConfig();
      const openaiApiKey = await prompt('OpenAI API Key (for embeddings)', existing.openaiApiKey || '');
      const anthropicApiKey = await prompt('Anthropic API Key (for sync & research)', existing.anthropicApiKey || '');

      await saveLoreConfig({
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

      // ── Step 3: Claim existing data ────────────────────────────────────
      console.log(c.bold('Step 3: Claim existing data\n'));

      const session = await loadAuthSession();
      if (session) {
        const claimData = await prompt(
          'Claim any unclaimed data in the database? (y/n)',
          'n'
        );

        if (claimData.toLowerCase() === 'y') {
          try {
            const { getDatabase } = await import('../../core/vector-store.js');
            const client = await getDatabase('');

            // Call the SECURITY DEFINER RPC that bypasses RLS to claim NULL rows
            const { data, error } = await client.rpc('claim_unclaimed_data');

            if (error) {
              throw error;
            }

            const row = data?.[0] || { sources_claimed: 0, chunks_claimed: 0 };
            console.log(
              c.success(
                `Claimed ${row.sources_claimed} sources and ${row.chunks_claimed} chunks.\n`
              )
            );
          } catch (error) {
            console.log(
              c.warning(
                'Could not claim data automatically. Make sure the migration has been applied.\n'
              )
            );
          }
        } else {
          console.log(c.dim('Skipped.\n'));
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
