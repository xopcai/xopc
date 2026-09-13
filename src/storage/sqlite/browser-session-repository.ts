import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { ResolvedGatewayAuth } from '../../gateway/auth.js';
import { getSqliteDatabase, runSqliteWriteTransaction } from './transaction.js';

export const BROWSER_SESSION_TTL_MS = 30 * 24 * 3_600_000;
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
function fingerprint(auth: ResolvedGatewayAuth): string | null {
  const credential = auth.mode === 'token' ? auth.token : auth.mode === 'password' ? auth.password : undefined;
  return credential ? digest(JSON.stringify([auth.mode, credential])) : null;
}
export class BrowserSessionLimitError extends Error {
  constructor() { super('Browser session limit reached'); }
}
export function createBrowserSession(auth: ResolvedGatewayAuth, replacedSessionId?: string) {
  const authFingerprint = fingerprint(auth);
  if (!authFingerprint) throw new Error('Browser sessions require Gateway credentials');
  const sessionId = randomUUID();
  const token = randomBytes(32).toString('base64url');
  const now = Date.now();
  const expiresAt = now + BROWSER_SESSION_TTL_MS;
  runSqliteWriteTransaction((db) => {
    db.prepare('DELETE FROM browser_sessions WHERE expires_at <= ? OR auth_fingerprint <> ?').run(now, authFingerprint);
    if (replacedSessionId) db.prepare('DELETE FROM browser_sessions WHERE session_id = ?').run(replacedSessionId);
    const count = db.prepare('SELECT count(*) AS count FROM browser_sessions').get() as { count: number };
    if (count.count >= 32) throw new BrowserSessionLimitError();
    db.prepare('INSERT INTO browser_sessions (session_id, token_hash, auth_fingerprint, created_at, expires_at) VALUES (?, ?, ?, ?, ?)')
      .run(sessionId, digest(token), authFingerprint, now, expiresAt);
  });
  return { sessionId, token, expiresAt };
}
export function authenticateBrowserSession(token: string, auth: ResolvedGatewayAuth): { sessionId: string; expiresAt: number; renewed: boolean } | null {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const row = getSqliteDatabase().prepare('SELECT session_id, expires_at FROM browser_sessions WHERE token_hash = ? AND auth_fingerprint = ? AND expires_at > ?')
    .get(digest(token), fingerprint(auth), Date.now()) as { session_id: string; expires_at: number } | undefined;
  if (!row) return null;
  const renewed = row.expires_at < Date.now() + 7 * 24 * 3_600_000;
  const expiresAt = renewed ? Date.now() + BROWSER_SESSION_TTL_MS : row.expires_at;
  if (renewed) getSqliteDatabase().prepare('UPDATE browser_sessions SET expires_at = ? WHERE session_id = ?').run(expiresAt, row.session_id);
  return { sessionId: row.session_id, expiresAt, renewed };
}
export function isBrowserSessionActive(sessionId: string, auth: ResolvedGatewayAuth): boolean {
  return Boolean(getSqliteDatabase().prepare('SELECT 1 FROM browser_sessions WHERE session_id = ? AND auth_fingerprint = ? AND expires_at > ?')
    .get(sessionId, fingerprint(auth), Date.now()));
}
export function deleteBrowserSession(sessionId: string): void {
  getSqliteDatabase().prepare('DELETE FROM browser_sessions WHERE session_id = ?').run(sessionId);
}
