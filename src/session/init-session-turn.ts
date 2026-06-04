import { randomUUID } from 'node:crypto';

import { SessionConfigSchema, type Config } from '../config/schema.js';
import { parseSessionKey } from '../routing/session-key.js';
import { createLogger } from '../utils/logger.js';

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
import { resolveSessionKeyForRequest } from './resolve-session.js';

const log = createLogger('InitSessionTurn');

export type SessionResetFn = (
  sessionKey: string,
) => Promise<{ sessionId: string; previousSessionId: string } | null>;

export type InitSessionTurnResult = {
  sessionKey: string;
  sessionId?: string;
  previousSessionId?: string;
  isNewSession: boolean;
  resetTriggered: boolean;
  staleRollover: boolean;
  bodyStripped: string;
  bareReset: boolean;
  ackMessage?: string;
};

export type InitSessionTurnOptions = {
  cfg: Config;
  sessionKey: string;
  body?: string;
  resetSession: SessionResetFn;
  /** When true, skip idle/daily implicit rollover (provider-owned CLI sessions). */
  skipImplicitExpiry?: boolean;
};

/**
 * Turn-start session init: match `resetTriggers`, evaluate freshness, archive +
 * assign new `sessionId` when stale or explicitly reset. OpenClaw `initSessionState`
 * equivalent for xopc direct + channel paths.
 */
export async function initSessionTurn(
  opts: InitSessionTurnOptions,
): Promise<InitSessionTurnResult> {
  const sessionCfg = opts.cfg.session ?? SessionConfigSchema.parse({});
  const triggers = resolveResetTriggers(sessionCfg.resetTriggers);
  const rawBody = opts.body ?? '';
  const triggerMatch = matchResetTriggers(rawBody, triggers);

  const { sessionKey, sessionStore } = await resolveSessionKeyForRequest({
    cfg: opts.cfg,
    sessionKey: opts.sessionKey,
  });
  const key = sessionKey?.trim() ?? opts.sessionKey.trim();
  const sessionEntry = key ? sessionStore[key] : undefined;

  const parsed = key ? parseSessionKey(key) : null;
  const peerKind = parsed?.peerKind;
  const resetType = resolveSessionResetType({
    sessionKey: key,
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
  const now = Date.now();
  const freshness = sessionEntry
    ? evaluateSessionFreshness({
        updatedAt: sessionEntry.updatedAt,
        ...lifecycle,
        now,
        policy: resetPolicy,
      })
    : { fresh: false };

  const skipImplicit = opts.skipImplicitExpiry ?? false;
  const staleRollover = Boolean(sessionEntry && !skipImplicit && !freshness.fresh);
  const needsRollover = triggerMatch.resetTriggered || staleRollover;

  let sessionId = sessionEntry?.sessionId;
  let previousSessionId: string | undefined;
  let isNewSession = false;

  if (needsRollover && sessionEntry?.sessionId) {
    const outcome = await opts.resetSession(key);
    if (outcome) {
      previousSessionId = outcome.previousSessionId;
      sessionId = outcome.sessionId;
      isNewSession = true;
      log.info(
        {
          sessionKey: key,
          sessionId: outcome.sessionId,
          previousSessionId: outcome.previousSessionId,
          resetTriggered: triggerMatch.resetTriggered,
          staleRollover,
          resetType,
        },
        triggerMatch.resetTriggered
          ? 'Session reset via reset trigger'
          : 'Session rolled over (stale freshness)',
      );
    } else {
      log.warn({ sessionKey: key }, 'Session rollover requested but resetSession returned null');
      sessionId = randomUUID();
      isNewSession = true;
    }
  } else if (!sessionEntry) {
    isNewSession = true;
    sessionId = randomUUID();
  }

  const bareReset = triggerMatch.resetTriggered && triggerMatch.bareReset;
  const ackMessage = bareReset ? bareResetAckMessage(triggerMatch.matchedTrigger) : undefined;

  return {
    sessionKey: key,
    sessionId,
    previousSessionId,
    isNewSession,
    resetTriggered: triggerMatch.resetTriggered,
    staleRollover,
    bodyStripped: triggerMatch.resetTriggered ? triggerMatch.bodyStripped : rawBody,
    bareReset,
    ackMessage,
  };
}
