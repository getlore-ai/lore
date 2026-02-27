/**
 * Auth Commands
 *
 * lore auth login  — interactive OTP flow
 * lore auth logout — clear session
 * lore auth whoami — show current user/status
 * lore setup       — guided wizard (delegated to setup.ts)
 */

import type { Command } from 'commander';
import { c } from '../colors.js';
import { registerSetupCommand } from './setup.js';

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

  // ── lore setup (delegated to setup.ts) ──────────────────────────────────
  registerSetupCommand(program);
}
