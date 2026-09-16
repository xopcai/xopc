import { randomUUID } from 'node:crypto';

import { SessionConfigSchema, type Config } from '../config/schema.js';
import { createLogger } from '../utils/logger.js';
import { requireXopcDatabase } from '../storage/sqlite/index.js';
import { resolveSessionLifecycleTimestamps } from './lifecycle-timestamps.js';
import {
  evaluateSessionFreshness,
  resolveSessionResetPolicy,
} from './reset-policy.js';
import {
  bareResetAckMessage,
  matchResetTriggers,
  resolveResetTriggers,
} from './reset-triggers.js';
import { resolveChannelResetConfig, resolveSessionResetType } from './reset-type.js';
import { resolveConversationIdForRequest } from './resolve-session.js';

const log = createLogger('InitSessionTurn');

export type SessionResetFn = (
  conversationId: string,
) => Promise<{ transcriptId: string; previousTranscriptId: string } | null>;

export type InitSessionTurnResult = {
  conversationId: string;
  transcriptId?: string;
  previousTranscriptId?: string;
  isNewSession: boolean;
  resetTriggered: boolean;
  staleRollover: boolean;
  bodyStripped: string;
  bareReset: boolean;
  ackMessage?: string;
};

export type InitSessionTurnOptions = {
  cfg: Config;
  conversationId: string;
  body?: string;
  resetSession: SessionResetFn;
};

export async function initSessionTurn(
  opts: InitSessionTurnOptions,
): Promise<InitSessionTurnResult> {
  requireXopcDatabase();

  const sessionCfg = opts.cfg.session ?? SessionConfigSchema.parse({});
  const triggers = resolveResetTriggers(sessionCfg.resetTriggers);
  const rawBody = opts.body ?? '';
  const triggerMatch = matchResetTriggers(rawBody, triggers);

  const { conversationId, sessionMetadata } = await resolveConversationIdForRequest({
    cfg: opts.cfg,
    conversationId: opts.conversationId,
  });
  const key = conversationId?.trim() ?? opts.conversationId.trim();

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
  const now = Date.now();
  const freshness = sessionMetadata
    ? evaluateSessionFreshness({
        updatedAt: Date.parse(sessionMetadata.updatedAt),
        ...lifecycle,
        now,
        policy: resetPolicy,
      })
    : { fresh: false };

  const staleRollover = Boolean(
    sessionMetadata && resetPolicy.configured === true && !freshness.fresh,
  );
  const needsRollover = triggerMatch.resetTriggered || staleRollover;

  let transcriptId = sessionMetadata?.transcriptId;
  let previousTranscriptId: string | undefined;
  let isNewSession = false;

  if (needsRollover && sessionMetadata?.transcriptId) {
    const task = await opts.resetSession(key);
    if (task) {
      previousTranscriptId = task.previousTranscriptId;
      transcriptId = task.transcriptId;
      isNewSession = true;
      log.info(
        {
          conversationId: key,
          transcriptId: task.transcriptId,
          previousTranscriptId: task.previousTranscriptId,
          resetTriggered: triggerMatch.resetTriggered,
          staleRollover,
          resetType,
        },
        triggerMatch.resetTriggered
          ? 'Session reset via reset trigger'
          : 'Session rolled over (stale freshness)',
      );
    } else {
      log.warn({ conversationId: key }, 'Session rollover requested but resetSession returned null');
      transcriptId = randomUUID();
      isNewSession = true;
    }
  } else if (!sessionMetadata) {
    isNewSession = true;
    transcriptId = randomUUID();
  }

  const bareReset = triggerMatch.resetTriggered && triggerMatch.bareReset;
  const ackMessage = bareReset ? bareResetAckMessage(triggerMatch.matchedTrigger) : undefined;

  return {
    conversationId: key,
    transcriptId,
    previousTranscriptId,
    isNewSession,
    resetTriggered: triggerMatch.resetTriggered,
    staleRollover,
    bodyStripped: triggerMatch.resetTriggered ? triggerMatch.bodyStripped : rawBody,
    bareReset,
    ackMessage,
  };
}
