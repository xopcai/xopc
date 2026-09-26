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
  findConversationIdByTranscriptId,
  getSessionConfig,
  getSessionMetadata,
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
  transcriptId: string;
  conversationId?: string;
  sessionMetadata?: SessionMetadata | null;
  isNewSession: boolean;
  persistedThinking?: ThinkLevel;
  persistedVerbose?: VerboseLevel;
};

export type ConversationIdResolution = {
  conversationId?: string;
  sessionMetadata?: SessionMetadata | null;
};

export async function resolveConversationIdForRequest(opts: {
  cfg: Config;
  conversationId?: string;
  transcriptId?: string;
  agentId?: string;
}): Promise<ConversationIdResolution> {
  requireXopcDatabase();
  const explicitKey = opts.conversationId?.trim();
  const requestedTranscriptId = opts.transcriptId?.trim();

  let conversationId = explicitKey;
  if (requestedTranscriptId && !conversationId) {
    conversationId = findConversationIdByTranscriptId(requestedTranscriptId) ?? undefined;
  }

  const sessionMetadata = conversationId ? getSessionMetadata(conversationId) : null;
  return { conversationId, sessionMetadata };
}

export async function resolveSession(opts: {
  cfg: Config;
  conversationId?: string;
  transcriptId?: string;
  agentId?: string;
}): Promise<SessionResolution> {
  const sessionCfg = opts.cfg.session ?? SessionConfigSchema.parse({});
  const { conversationId, sessionMetadata } = await resolveConversationIdForRequest(opts);
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
  const transcriptId =
    opts.transcriptId?.trim() || (fresh ? sessionMetadata?.transcriptId : undefined) || randomUUID();
  const isNewSession = !fresh && !opts.transcriptId?.trim();

  if (isNewSession && conversationId) {
    log.debug(
      { conversationId, previousTranscriptId: sessionMetadata?.transcriptId, transcriptId, resetType },
      'Session reset boundary: new session id for turn',
    );
  }

  const persistedThinking =
    fresh && conversationId
      ? normalizeThinkLevel(getSessionConfig(conversationId)?.thinkingLevel)
      : undefined;
  const persistedVerbose =
    fresh && conversationId
      ? normalizeVerboseLevel(getSessionConfig(conversationId)?.verboseLevel)
      : undefined;

  return {
    transcriptId,
    conversationId,
    sessionMetadata,
    isNewSession,
    persistedThinking,
    persistedVerbose,
  };
}
