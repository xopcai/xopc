/**
 * Maps a session key to a relative directory under the agent sessions root.
 * Routing keys → flat `users/` (one dir, files named by sanitized session key); cron & heartbeat → system/...
 */

import { join } from 'path';

import { parseSessionKey } from '../routing/session-key.js';

/** Max length per path segment (directory name). */
const MAX_SEG = 120;

/**
 * Sanitize one path segment (directory or file stem fragment).
 */
export function sanitizeSessionPathSegment(value: string): string {
  const s = value.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, MAX_SEG);
  return s || 'unknown';
}

/**
 * Relative directory (no leading slash) where session JSON / meta files live.
 */
export function resolveSessionShardRelativePath(sessionKey: string): string {
  const raw = (sessionKey ?? '').trim();
  if (!raw) {
    return join('system', 'misc');
  }

  const parts = raw.split(':').filter(Boolean);

  if (parts.length >= 2 && parts[0] === 'cron') {
    return join('system', 'cron');
  }

  if (parts.length >= 2 && parts[0] === 'heartbeat') {
    return join('system', 'heartbeat');
  }

  const parsed = parseSessionKey(raw);
  if (!parsed) {
    return join('system', 'misc');
  }

  return 'users';
}
