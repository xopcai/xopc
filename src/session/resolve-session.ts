import { randomUUID } from 'node:crypto';

import { SessionConfigSchema, type Config } from '../config/schema.js';
import {
  normalizeThinkLevel,
  normalizeVerboseLevel,
  type ThinkLevel,
  type VerboseLevel,
} from '../agent/transcript/thinking-types.js';
import { createLogger } from '../utils/logger.js';
import {
  findSessionKeyBySessionId,
  getSessionMetadata,
  getSessionPersistedLevels,
  requireXopcDatabase,
} from '../storage/sqlite/index.js';

import { resolveSessionLifecycleTimestamps } from './lifecycle-timestamps.js';
import {
  evaluateSessionFreshness,
  resolveSessionResetPolicy,
} from './reset-policy.js';
import { resolveChannelResetConfig, resolveSessionResetType } from './reset-type.js';
import type { SessionMetadata } from './types.js';

const log = createLogger('ResolveSession');

export type SessionResolution = {
  sessionId: string;
  sessionKey?: string;
  sessionMetadata?: SessionMetadata | null;
  isNewSession: boolean;
  persistedThinking?: ThinkLevel;
  persistedVerbose?: VerboseLevel;
};

export type SessionKeyResolution = {
  sessionKey?: string;
  sessionMetadata?: SessionMetadata | null;
};

export async function resolveSessionKeyForRequest(opts: {
  cfg: Config;
  sessionKey?: string;
  sessionId?: string;
  agentId?: string;
}): Promise<SessionKeyResolution> {
  requireXopcDatabase();
  const explicitKey = opts.sessionKey?.trim();
  const requestedSessionId = opts.sessionId?.trim();

  let sessionKey = explicitKey;
  if (requestedSessionId && !sessionKey) {
    sessionKey = findSessionKeyBySessionId(requestedSessionId) ?? undefined;
  }

  const sessionMetadata = sessionKey ? getSessionMetadata(sessionKey) : null;
  return { sessionKey, sessionMetadata };
}

export async function resolveSession(opts: {
  cfg: Config;
  sessionKey?: string;
  sessionId?: string;
  agentId?: string;
}): Promise<SessionResolution> {
  const sessionCfg = opts.cfg.session ?? SessionConfigSchema.parse({});
  const { sessionKey, sessionMetadata } = await resolveSessionKeyForRequest(opts);
  const now = Date.now();

  const routing = sessionMetadata?.routing;
  const peerKind = routing?.peerKind;
  const resetType = resolveSessionResetType({
    isGroup: peerKind === 'group' || peerKind === 'channel',
    isThread: Boolean(routing?.threadId),
  });
  const channelReset = resolveChannelResetConfig({
    sessionCfg,
    channel: routing?.source ?? sessionMetadata?.sourceChannel,
  });
  const resetPolicy = resolveSessionResetPolicy({
    sessionCfg,
    resetType,
    resetOverride: channelReset,
  });
  const lifecycle = resolveSessionLifecycleTimestamps({
    entry: sessionMetadata
      ? {
          updatedAt: Date.parse(sessionMetadata.updatedAt),
          sessionStartedAt: sessionMetadata.sessionStartedAt
            ? Date.parse(sessionMetadata.sessionStartedAt)
            : undefined,
          lastInteractionAt: sessionMetadata.lastInteractionAt
            ? Date.parse(sessionMetadata.lastInteractionAt)
            : undefined,
        }
      : undefined,
  });
  const freshness = sessionMetadata
    ? evaluateSessionFreshness({
        updatedAt: Date.parse(sessionMetadata.updatedAt),
        ...lifecycle,
        now,
        policy: resetPolicy,
      })
    : { fresh: false };
  const fresh = freshness.fresh;
  const sessionId =
    opts.sessionId?.trim() || (fresh ? sessionMetadata?.sessionId : undefined) || randomUUID();
  const isNewSession = !fresh && !opts.sessionId?.trim();

  if (isNewSession && sessionKey) {
    log.debug(
      { sessionKey, previousSessionId: sessionMetadata?.sessionId, sessionId, resetType },
      'Session reset boundary: new session id for turn',
    );
  }

  const persistedThinking =
    fresh && sessionKey
      ? normalizeThinkLevel(getSessionPersistedLevels(sessionKey)?.thinkingLevel ?? undefined)
      : undefined;
  const persistedVerbose =
    fresh && sessionKey
      ? normalizeVerboseLevel(getSessionPersistedLevels(sessionKey)?.verboseLevel ?? undefined)
      : undefined;

  return {
    sessionId,
    sessionKey,
    sessionMetadata,
    isNewSession,
    persistedThinking,
    persistedVerbose,
  };
}
