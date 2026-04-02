/**
 * Maps a session key to a relative directory under the agent sessions root.
 * Routing keys → `users/{agent}/{source}/{account}/{peerKind}/{peerId}/…`; cron & heartbeat → `system/…`.
 * Web UI (`webchat` / `gateway`) + `direct` peers use a shorter `users/{agent}/web/…` layout (no redundant
 * `default`/`direct` segments). See `resolveLegacyDeepWebShardRelativePath` for the previous layout.
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
 * Previous on-disk layout for web UI direct sessions (before compact `users/.../web/...`).
 * Used to lazy-migrate existing files.
 */
export function resolveLegacyDeepWebShardRelativePath(sessionKey: string): string | null {
  const raw = (sessionKey ?? '').trim();
  if (!raw) return null;

  const parsed = parseSessionKey(raw);
  if (!parsed) return null;
  if (parsed.peerKind !== 'direct') return null;
  if (parsed.source !== 'webchat' && parsed.source !== 'gateway') return null;

  const segments: string[] = [
    'users',
    sanitizeSessionPathSegment(parsed.agentId),
    sanitizeSessionPathSegment(parsed.source),
    sanitizeSessionPathSegment(parsed.accountId),
    'direct',
    sanitizeSessionPathSegment(parsed.peerId),
  ];
  if (parsed.threadId) {
    segments.push('thread', sanitizeSessionPathSegment(parsed.threadId));
  }
  if (parsed.scopeId) {
    segments.push('scope', sanitizeSessionPathSegment(parsed.scopeId));
  }
  return join(...segments);
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

  // Web UI: omit redundant account/direct segments; keep non-default account as one folder.
  if (
    parsed.peerKind === 'direct' &&
    (parsed.source === 'webchat' || parsed.source === 'gateway')
  ) {
    const segments: string[] = [
      'users',
      sanitizeSessionPathSegment(parsed.agentId),
      'web',
    ];
    if (parsed.accountId !== 'default') {
      segments.push(sanitizeSessionPathSegment(parsed.accountId));
    }
    segments.push(sanitizeSessionPathSegment(parsed.peerId));
    if (parsed.threadId) {
      segments.push('thread', sanitizeSessionPathSegment(parsed.threadId));
    }
    if (parsed.scopeId) {
      segments.push('scope', sanitizeSessionPathSegment(parsed.scopeId));
    }
    return join(...segments);
  }

  const segments: string[] = [
    'users',
    sanitizeSessionPathSegment(parsed.agentId),
    sanitizeSessionPathSegment(parsed.source),
    sanitizeSessionPathSegment(parsed.accountId),
    sanitizeSessionPathSegment(parsed.peerKind),
    sanitizeSessionPathSegment(parsed.peerId),
  ];
  if (parsed.threadId) {
    segments.push('thread', sanitizeSessionPathSegment(parsed.threadId));
  }
  if (parsed.scopeId) {
    segments.push('scope', sanitizeSessionPathSegment(parsed.scopeId));
  }
  return join(...segments);
}
