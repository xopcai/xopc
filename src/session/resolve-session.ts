import { randomUUID } from 'node:crypto';

import { SessionConfigSchema, type Config } from '../config/schema.js';
import { resolveSessionsMapPath } from '../config/paths.js';
import { resolveDefaultAgentId } from '../agent/agent-scope.js';
import {
  normalizeAgentId,
  resolveAgentIdFromSessionKey,
} from '../routing/agent-session-key.js';
import { parseSessionKey } from '../routing/session-key.js';
import {
  normalizeThinkLevel,
  normalizeVerboseLevel,
  type ThinkLevel,
  type VerboseLevel,
} from '../agent/transcript/thinking-types.js';
import { createLogger } from '../utils/logger.js';

import { resolveSessionLifecycleTimestamps } from './lifecycle-timestamps.js';
import { readSessionsJsonFile } from './parity/sessions-json-file.js';
import type { XopcSessionDiskEntry } from './parity/xopc-session-disk-entry.js';
import {
  evaluateSessionFreshness,
  resolveSessionResetPolicy,
} from './reset-policy.js';
import { resolveChannelResetConfig, resolveSessionResetType } from './reset-type.js';

const log = createLogger('ResolveSession');

export type SessionResolution = {
  sessionId: string;
  sessionKey?: string;
  sessionEntry?: XopcSessionDiskEntry;
  sessionStore: Record<string, XopcSessionDiskEntry>;
  storePath: string;
  isNewSession: boolean;
  persistedThinking?: ThinkLevel;
  persistedVerbose?: VerboseLevel;
};

export type SessionKeyResolution = {
  sessionKey?: string;
  sessionStore: Record<string, XopcSessionDiskEntry>;
  storePath: string;
};

export async function resolveSessionKeyForRequest(opts: {
  cfg: Config;
  sessionKey?: string;
  sessionId?: string;
  agentId?: string;
}): Promise<SessionKeyResolution> {
  const defaultAgentId = resolveDefaultAgentId(opts.cfg);
  const explicitKey = opts.sessionKey?.trim();
  const requestedSessionId = opts.sessionId?.trim();
  const storeAgentId = explicitKey
    ? resolveAgentIdFromSessionKey(explicitKey)
    : opts.agentId?.trim()
      ? normalizeAgentId(opts.agentId)
      : defaultAgentId;
  const storePath = resolveSessionsMapPath(opts.cfg, storeAgentId);
  const sessionStore = await readSessionsJsonFile<XopcSessionDiskEntry>(storePath);

  let sessionKey = explicitKey;
  if (requestedSessionId && !sessionKey) {
    for (const [key, entry] of Object.entries(sessionStore)) {
      if (entry?.sessionId === requestedSessionId) {
        sessionKey = key;
        break;
      }
    }
  }
  if (requestedSessionId && !sessionKey) {
    sessionKey = `agent:${normalizeAgentId(opts.agentId ?? storeAgentId)}:explicit:${requestedSessionId}`;
  }

  return { sessionKey, sessionStore, storePath };
}

export async function resolveSession(opts: {
  cfg: Config;
  sessionKey?: string;
  sessionId?: string;
  agentId?: string;
}): Promise<SessionResolution> {
  const sessionCfg = opts.cfg.session ?? SessionConfigSchema.parse({});
  const { sessionKey, sessionStore, storePath } = await resolveSessionKeyForRequest(opts);
  const now = Date.now();
  const sessionEntry = sessionKey ? sessionStore[sessionKey] : undefined;

  const parsed = sessionKey ? parseSessionKey(sessionKey) : null;
  const peerKind = parsed?.peerKind;
  const resetType = resolveSessionResetType({
    sessionKey,
    isGroup: peerKind === 'group' || peerKind === 'channel',
    isThread: Boolean(parsed?.threadId),
  });
  const meta = sessionEntry?.pluginExtensions?.xopc?.metadata;
  const channelReset = resolveChannelResetConfig({
    sessionCfg,
    channel: parsed?.source ?? meta?.sourceChannel,
  });
  const resetPolicy = resolveSessionResetPolicy({
    sessionCfg,
    resetType,
    resetOverride: channelReset,
  });
  const lifecycle = resolveSessionLifecycleTimestamps({ entry: sessionEntry });
  const freshness = sessionEntry
    ? evaluateSessionFreshness({
        updatedAt: sessionEntry.updatedAt,
        ...lifecycle,
        now,
        policy: resetPolicy,
      })
    : { fresh: false };
  const fresh = freshness.fresh;
  const sessionId =
    opts.sessionId?.trim() || (fresh ? sessionEntry?.sessionId : undefined) || randomUUID();
  const isNewSession = !fresh && !opts.sessionId?.trim();

  if (isNewSession && sessionKey) {
    log.debug(
      { sessionKey, previousSessionId: sessionEntry?.sessionId, sessionId, resetType },
      'Session reset boundary — new transcript id for turn',
    );
  }

  const persistedThinking =
    fresh && sessionEntry?.thinkingLevel
      ? normalizeThinkLevel(sessionEntry.thinkingLevel)
      : undefined;
  const persistedVerbose =
    fresh && sessionEntry?.verboseLevel
      ? normalizeVerboseLevel(sessionEntry.verboseLevel)
      : undefined;

  return {
    sessionId,
    sessionKey,
    sessionEntry,
    sessionStore,
    storePath,
    isNewSession,
    persistedThinking,
    persistedVerbose,
  };
}
