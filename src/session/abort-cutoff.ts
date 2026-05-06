/**
 * Webchat abort cutoff (OpenClaw-style): stale in-flight POSTs after /api/agent/abort
 * are ignored when the client sends `clientCreatedAtMs` from send time.
 */

import type { SessionMetadata } from './types.js';

export function shouldSkipWebchatInboundByAbortCutoff(
  meta: SessionMetadata | null | undefined,
  clientCreatedAtMs?: number,
): boolean {
  if (!meta?.abortCutoffTimestamp) {
    return false;
  }
  if (typeof clientCreatedAtMs !== 'number' || !Number.isFinite(clientCreatedAtMs)) {
    return false;
  }
  return clientCreatedAtMs <= meta.abortCutoffTimestamp;
}
