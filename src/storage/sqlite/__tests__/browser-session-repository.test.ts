import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { openXopcDatabase, closeXopcDatabase } from '../connection.js';
import { getSqliteDatabase } from '../transaction.js';
import { authenticateBrowserSession, BrowserSessionLimitError, BROWSER_SESSION_TTL_MS, createBrowserSession, isBrowserSessionActive } from '../browser-session-repository.js';
const auth = { mode: 'token' as const, token: 'test-owner-token' };
beforeEach(() => openXopcDatabase({ path: ':memory:' }));
afterEach(() => { vi.useRealTimers(); closeXopcDatabase(); });
it('stores only a token hash, renews active sessions, and rejects expired or rotated credentials', () => {
  const session = createBrowserSession(auth);
  const row = getSqliteDatabase().prepare('SELECT * FROM browser_sessions').get();
  expect(JSON.stringify(row)).not.toContain(session.token);
  expect(JSON.stringify(row)).not.toContain(auth.token);
  vi.useFakeTimers({ now: Date.now() + 25 * 86400000 });
  const renewed = authenticateBrowserSession(session.token, auth);
  expect(renewed).toMatchObject({ sessionId: session.sessionId, renewed: true });
  expect(renewed!.expiresAt).toBe(Date.now() + BROWSER_SESSION_TTL_MS);
  expect(isBrowserSessionActive(session.sessionId, { ...auth, token: 'rotated' })).toBe(false);
  vi.setSystemTime(renewed!.expiresAt);
  expect(authenticateBrowserSession(session.token, auth)).toBeNull();
});
it('allows atomic replacement at the session cap and retains existing sessions when new login is denied', () => {
  const sessions = Array.from({ length: 32 }, () => createBrowserSession(auth));
  expect(() => createBrowserSession(auth)).toThrow(BrowserSessionLimitError);
  expect(authenticateBrowserSession(sessions[0].token, auth)).not.toBeNull();
  const replaced = createBrowserSession(auth, sessions[0].sessionId);
  expect(authenticateBrowserSession(sessions[0].token, auth)).toBeNull();
  expect(authenticateBrowserSession(replaced.token, auth)).not.toBeNull();
});
