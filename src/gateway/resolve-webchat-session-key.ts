import { randomUUID } from 'node:crypto';

import type { Config } from '../config/schema.js';
import {
  buildAgentMainSessionKey,
  normalizeMainKey,
} from '../routing/agent-session-key.js';
import { buildSessionKey, parseSessionKey } from '../routing/session-key.js';
import { getDefaultAgentId } from '../routing/resolve-route.js';

export type ResolveWebchatSessionKeyInput = {
  cfg: Config;
  sessionKey?: string;
  chatId?: string;
  newSession?: boolean;
};

export type ResolveWebchatSessionKeyResult =
  | { ok: true; sessionKey: string }
  | { ok: false; error: string };

/**
 * Resolve the canonical `agent:` session key for webchat `/api/agent` requests.
 * Rejects bare legacy peer ids (e.g. `chat_*` without `agent:` prefix).
 */
export function resolveWebchatSessionKey(
  input: ResolveWebchatSessionKeyInput,
): ResolveWebchatSessionKeyResult {
  const agentId = getDefaultAgentId(input.cfg);
  const mainKey = normalizeMainKey(input.cfg.session?.mainKey);

  if (input.newSession) {
    return {
      ok: true,
      sessionKey: buildSessionKey({
        agentId,
        source: 'webchat',
        accountId: 'default',
        peerKind: 'direct',
        peerId: `chat_${randomUUID()}`,
      }),
    };
  }

  const raw = (input.sessionKey?.trim() || input.chatId?.trim() || '').trim();
  if (!raw || raw === 'default') {
    return { ok: true, sessionKey: buildAgentMainSessionKey({ agentId, mainKey }) };
  }

  if (!parseSessionKey(raw)) {
    return {
      ok: false,
      error: 'sessionKey must use agent:{agentId}:{rest} format; create sessions via POST /api/sessions',
    };
  }

  return { ok: true, sessionKey: raw };
}
