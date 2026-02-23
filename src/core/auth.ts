/**
 * Lore - Supabase Auth Session Management
 *
 * Stores auth session in ~/.config/lore/auth.json.
 * Uses its own unauthenticated Supabase client (publishable key only) for the auth flow,
 * separate from the vector-store singleton.
 */

import { readFile, writeFile, mkdir, unlink } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import http from 'http';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

import { getLoreConfigDir, loadLoreConfig } from './config.js';

// ============================================================================
// Types
// ============================================================================

export interface AuthSession {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  user: {
    id: string;
    email: string;
  };
}

// ============================================================================
// Paths
// ============================================================================

const AUTH_FILE = path.join(getLoreConfigDir(), 'auth.json');

export function getAuthFilePath(): string {
  return AUTH_FILE;
}

// ============================================================================
// Session Persistence
// ============================================================================

export async function loadAuthSession(): Promise<AuthSession | null> {
  if (!existsSync(AUTH_FILE)) {
    return null;
  }

  try {
    const content = await readFile(AUTH_FILE, 'utf-8');
    return JSON.parse(content) as AuthSession;
  } catch {
    return null;
  }
}

export async function saveAuthSession(session: AuthSession): Promise<void> {
  await mkdir(getLoreConfigDir(), { recursive: true });
  await writeFile(AUTH_FILE, JSON.stringify(session, null, 2) + '\n', { mode: 0o600 });
}

export async function clearAuthSession(): Promise<void> {
  if (existsSync(AUTH_FILE)) {
    await unlink(AUTH_FILE);
  }
}

// ============================================================================
// Auth Client (unauthenticated, publishable key only)
// ============================================================================

async function getAuthClient(): Promise<SupabaseClient> {
  const config = await loadLoreConfig();
  const url = config.supabaseUrl;
  const key = config.supabasePublishableKey;

  if (!url || !key) {
    throw new Error(
      'Supabase configuration is missing. This should not happen — please reinstall Lore.'
    );
  }

  return createClient(url, key);
}

// ============================================================================
// OTP Flow
// ============================================================================

export async function sendOTP(email: string): Promise<{ error?: string }> {
  const client = await getAuthClient();

  const { error } = await client.auth.signInWithOtp({ email });

  if (error) {
    return { error: error.message };
  }

  return {};
}

export async function verifyOTP(
  email: string,
  token: string
): Promise<{ session?: AuthSession; error?: string }> {
  const client = await getAuthClient();

  // Try 'magiclink' first (for returning users), then 'email', then 'signup' (for new users)
  const types = ['magiclink', 'email', 'signup'] as const;

  for (const type of types) {
    const { data, error } = await client.auth.verifyOtp({
      email,
      token,
      type,
    });

    if (!error && data.session && data.user) {
      return { session: toAuthSession(data.session, data.user, email) };
    }
  }

  // All types failed — return the last error
  return { error: 'Token has expired or is invalid. Request a new code with \'lore auth login\'.' };
}

/**
 * Extract session from a magic link URL (Supabase sends these for new signups).
 * Parses the access_token and refresh_token from the URL fragment/query.
 */
export async function sessionFromMagicLink(
  url: string
): Promise<{ session?: AuthSession; error?: string }> {
  try {
    // Supabase magic links put tokens in the fragment: .../#access_token=...&refresh_token=...
    const fragment = url.includes('#') ? url.split('#')[1] : url.split('?')[1];
    if (!fragment) {
      return { error: 'Could not parse magic link URL' };
    }

    const params = new URLSearchParams(fragment);
    const accessToken = params.get('access_token');
    const refreshToken = params.get('refresh_token');

    if (!accessToken || !refreshToken) {
      return { error: 'Magic link URL missing access_token or refresh_token' };
    }

    // Use the tokens to set the session in the Supabase client
    const client = await getAuthClient();
    const { data, error } = await client.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });

    if (error) {
      return { error: error.message };
    }

    if (!data.session || !data.user) {
      return { error: 'No session returned from magic link' };
    }

    return { session: toAuthSession(data.session, data.user) };
  } catch (err) {
    return { error: `Failed to parse magic link: ${err}` };
  }
}

// ============================================================================
// Helpers
// ============================================================================

function toAuthSession(
  session: { access_token: string; refresh_token: string; expires_at?: number },
  user: { id: string; email?: string },
  fallbackEmail?: string
): AuthSession {
  const authSession: AuthSession = {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_at: session.expires_at || 0,
    user: {
      id: user.id,
      email: user.email || fallbackEmail || '',
    },
  };

  // Fire-and-forget save (caller can also save explicitly)
  saveAuthSession(authSession);
  return authSession;
}

// ============================================================================
// Session Validation & Refresh
// ============================================================================

/**
 * Get a valid session, auto-refreshing if near expiry (within 5 minutes).
 * Returns null if no session or refresh fails.
 */
export async function getValidSession(): Promise<AuthSession | null> {
  const session = await loadAuthSession();
  if (!session) return null;

  const now = Math.floor(Date.now() / 1000);
  const bufferSeconds = 5 * 60; // 5 minutes

  // Session still valid and not near expiry
  if (session.expires_at > now + bufferSeconds) {
    return session;
  }

  // Try to refresh the token.
  // If refresh fails but token hasn't technically expired yet, return it.
  // If refresh fails AND token is past expires_at, return null (unusable).
  // We never delete auth.json here — preserves refresh_token for later retry.
  try {
    const client = await getAuthClient();
    const { data, error } = await client.auth.refreshSession({
      refresh_token: session.refresh_token,
    });

    if (error || !data.session || !data.user) {
      console.error(`[auth] Token refresh failed: ${error?.message || 'no session returned'}`);
      // Token hasn't expired yet — still usable despite refresh failure
      if (session.expires_at > now) {
        return session;
      }
      // Token is actually expired AND refresh failed — unusable
      console.error('[auth] Session expired and refresh failed. Run \'lore auth login\' to re-authenticate.');
      return null;
    }

    const refreshed: AuthSession = {
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      expires_at: data.session.expires_at || 0,
      user: {
        id: data.user.id,
        email: data.user.email || session.user.email,
      },
    };

    await saveAuthSession(refreshed);
    return refreshed;
  } catch (err) {
    console.error(`[auth] Token refresh error: ${err}`);
    if (session.expires_at > now) {
      return session;
    }
    console.error('[auth] Session expired and refresh failed. Run \'lore auth login\' to re-authenticate.');
    return null;
  }
}

/**
 * Quick check: is there a valid (or refreshable) auth session?
 */
export async function isAuthenticated(): Promise<boolean> {
  const session = await getValidSession();
  return session !== null;
}

// ============================================================================
// Magic Link Callback Server
// ============================================================================

const CALLBACK_HTML = `<!DOCTYPE html>
<html><head><title>Lore Login</title>
<style>
  body { font-family: system-ui, sans-serif; display: flex; justify-content: center;
         align-items: center; min-height: 100vh; margin: 0; background: #1a1a2e; color: #e0e0e0; }
  .card { background: #16213e; padding: 2rem 3rem; border-radius: 12px; text-align: center;
          box-shadow: 0 4px 24px rgba(0,0,0,0.3); }
  h1 { color: #00d4aa; margin-bottom: 0.5rem; }
  p { color: #a0a0b0; }
</style></head>
<body><div class="card">
  <h1 id="title">Signing you in...</h1>
  <p id="msg">Sending credentials to Lore CLI</p>
</div>
<script>
  const hash = window.location.hash.substring(1);
  if (hash) {
    fetch('/callback', { method: 'POST', headers: {'Content-Type':'application/x-www-form-urlencoded'}, body: hash })
      .then(r => r.json())
      .then(d => {
        document.getElementById('title').textContent = 'Signed in!';
        document.getElementById('msg').textContent = d.email ? 'Logged in as ' + d.email + '. You can close this tab.' : 'You can close this tab.';
      })
      .catch(() => {
        document.getElementById('title').textContent = 'Error';
        document.getElementById('msg').textContent = 'Could not complete login. Try pasting the URL into the terminal.';
      });
  } else {
    document.getElementById('title').textContent = 'No credentials found';
    document.getElementById('msg').textContent = 'The magic link may have expired.';
  }
</script></body></html>`;

/**
 * Start a temporary local HTTP server to catch the Supabase magic link redirect.
 * The magic link redirects to http://localhost:3000/#access_token=...
 * This server serves an HTML page that extracts the fragment and POSTs it back.
 *
 * Tries the configured redirect port (default 3000), then falls back to
 * alternatives if that port is occupied.
 *
 * Returns a promise that resolves with the auth session when the callback is received,
 * or null if it times out / all ports fail.
 */
export function waitForMagicLinkCallback(options: {
  timeoutMs?: number;
  onListening?: (port: number) => void;
}): { promise: Promise<AuthSession | null>; abort: () => void } {
  const { timeoutMs = 120_000, onListening } = options;
  // Must match the Supabase project's "Site URL" setting.
  // We use an uncommon port to avoid clashing with dev servers.
  // Configure in Supabase Dashboard > Auth > URL Configuration > Site URL:
  //   http://localhost:54321
  const portsToTry = [54321];

  let server: http.Server | null = null;
  let timeout: NodeJS.Timeout;
  let resolved = false;

  const promise = new Promise<AuthSession | null>(async (resolve) => {
    const finish = (session: AuthSession | null) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      server?.close();
      resolve(session);
    };

    const handler = (req: http.IncomingMessage, res: http.ServerResponse) => {
      if (req.method === 'GET' && (req.url === '/' || req.url?.startsWith('/#'))) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(CALLBACK_HTML);
        return;
      }

      if (req.method === 'POST' && req.url === '/callback') {
        let body = '';
        req.on('data', (chunk: string) => { body += chunk; });
        req.on('end', async () => {
          try {
            const params = new URLSearchParams(body);
            const accessToken = params.get('access_token');
            const refreshToken = params.get('refresh_token');

            if (!accessToken || !refreshToken) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Missing tokens' }));
              return;
            }

            const client = await getAuthClient();
            const { data, error } = await client.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken,
            });

            if (error || !data.session || !data.user) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: error?.message || 'Session failed' }));
              return;
            }

            const session = toAuthSession(data.session, data.user);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, email: session.user.email }));
            finish(session);
          } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: String(err) }));
          }
        });
        return;
      }

      res.writeHead(404);
      res.end();
    };

    // Try each port until one works
    for (const port of portsToTry) {
      try {
        server = await tryListen(handler, port);
        onListening?.(port);
        break;
      } catch {
        // Port in use, try next
        continue;
      }
    }

    if (!server) {
      // All ports occupied — fall back to manual flow
      finish(null);
      return;
    }

    timeout = setTimeout(() => finish(null), timeoutMs);
  });

  const abort = () => {
    if (!resolved) {
      resolved = true;
      clearTimeout(timeout);
      server?.close();
    }
  };

  return { promise, abort };
}

function tryListen(
  handler: http.RequestListener,
  port: number
): Promise<http.Server> {
  return new Promise((resolve, reject) => {
    const s = http.createServer(handler);
    s.on('error', reject);
    s.listen(port, () => resolve(s));
  });
}
