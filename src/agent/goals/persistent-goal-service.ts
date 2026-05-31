/**
 * PersistentGoalService — owns the "/goal" runtime: continuation scheduling,
 * the `PersistentGoalApis` bag that command handlers receive, and the post-turn
 * verdict hook called from `OutboundCoordinator`.
 *
 * Previously this logic was scattered across `AgentService`:
 *   - `setPersistentGoalWebchatContinuationScheduler` + a private callback field
 *   - `schedulePersistentGoalContinuation` (bus vs webchat fork)
 *   - `getPersistentGoalApisForCommand` (~40-line API factory)
 *   - `recordPersistentGoalStreamOutcome` / `takePersistentGoalStreamOutcome`
 *   - the `/goal` half of `emitSessionTurnComplete` (delegated to
 *     `handlePersistentGoalPostTurn`)
 *
 * Concentrating it here gives the rest of `AgentService` a cleaner surface
 * (one collaborator instead of five methods) and makes the goal runtime
 * unit-testable in isolation.
 */

import type { AgentMessage } from '@earendil-works/pi-agent-core';

import type { Config } from '../../config/schema.js';
import type { MessageBus } from '../../infra/bus/index.js';
import type { ModelManager } from '../models/index.js';
import type { SessionStore } from '../../session/store.js';
import type { SessionStateBag } from '../session/index.js';
import { parseSessionKey as parseRoutingSessionKey } from '../../routing/session-key.js';
import { appendPiTranscriptMessage } from '../../session/parity/jsonl-transcript-io.js';
import { createLogger } from '../../utils/logger.js';
import type { PersistentGoalApis } from './persistent-goal-apis.js';
import { handlePersistentGoalPostTurn } from './post-turn.js';

const log = createLogger('PersistentGoalService');

export interface PersistentGoalRouting {
  sessionKey: string;
  channel: string;
  chatId: string;
  inboundMetadata?: Record<string, unknown>;
}

export interface SessionTurnCompletionForGoal {
  sessionKey: string;
  channel: string;
  chatId: string;
  assistantPlainText: string;
  aborted: boolean;
  streamError?: string;
  skipPersistentGoalPostTurn?: boolean;
  outboundMetadata?: Record<string, unknown>;
}

export interface PersistentGoalServiceOptions {
  bus: MessageBus;
  sessionStore: SessionStore;
  modelManager: ModelManager;
  sessionState: SessionStateBag;
  /** Effective config snapshot accessor. */
  getConfig: () => Config | undefined;
  /** Resolve the workspace directory for `appendAssistantReceipt` writes. */
  getResolvedWorkspaceForSession: (sessionKey: string) => string;
  /** Notify the gateway UI after a metadata change (replaces the in-bag emit). */
  onSessionMetadataUpdated?: (sessionKey: string) => void;
  /** Push an assistant token + transcript refresh into a live webchat stream. */
  notifyWebchatTranscriptAppend: (sessionKey: string, assistantText: string) => void;
}

export class PersistentGoalService {
  private readonly opts: PersistentGoalServiceOptions;
  /** Gateway only: webchat continuations bypass the bus and reuse `runGatewayAgent`. */
  private webchatContinuationScheduler?: (sessionKey: string, message: string) => void;

  constructor(opts: PersistentGoalServiceOptions) {
    this.opts = opts;
  }

  /** Register the gateway-side webchat continuation hook (set from `web-agent` wiring). */
  setWebchatContinuationScheduler(
    fn: ((sessionKey: string, message: string) => void) | undefined,
  ): void {
    this.webchatContinuationScheduler = fn;
  }

  /**
   * Continue a session after `/goal` decides the previous turn needs follow-up.
   * Webchat sessions go through the scheduler; bus-driven channels re-publish the
   * follow-up message as an inbound bus event so the existing inbound loop picks it up.
   */
  scheduleContinuation(
    sessionKey: string,
    message: string,
    routing: { channel: string; chatId: string; inboundMetadata?: Record<string, unknown> },
  ): void {
    const parsed = parseRoutingSessionKey(sessionKey);
    if (parsed?.source === 'webchat' && this.webchatContinuationScheduler) {
      this.webchatContinuationScheduler(sessionKey, message);
      return;
    }
    queueMicrotask(() => {
      void this.opts.bus
        .publishInbound({
          channel: routing.channel,
          chat_id: routing.chatId,
          sender_id: 'persistent-goal',
          content: message,
          metadata: { sessionKey, ...routing.inboundMetadata },
        })
        .catch((err) => {
          log.warn({ err, sessionKey }, 'Persistent goal: publishInbound failed');
        });
    });
  }

  /** Build the per-command `PersistentGoalApis` bag (transcript writers + scheduler closures). */
  buildApisForRouting(routing: PersistentGoalRouting): PersistentGoalApis {
    return {
      getSessionMetadata: (k) => this.opts.sessionStore.getMetadata(k),
      updateSessionMetadata: async (k, u) => {
        await this.opts.sessionStore.updateMetadata(k, u);
        this.opts.onSessionMetadataUpdated?.(k);
      },
      loadMessages: (k) => this.opts.sessionStore.loadMessages(k),
      saveMessages: (k, m) => this.opts.sessionStore.saveMessages(k, m),
      appendAssistantReceipt: async (k, text) => {
        const trimmed = text.trim();
        if (!trimmed) return;
        const { absPath } = await this.opts.sessionStore.resolveTranscriptPath(k);
        const workspaceDir = this.opts.getResolvedWorkspaceForSession(k);
        await appendPiTranscriptMessage({
          absPath,
          cwd: workspaceDir,
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: trimmed }],
            timestamp: Date.now(),
          } as AgentMessage,
          sessionKey: k,
        });
        this.opts.notifyWebchatTranscriptAppend(k, trimmed);
      },
      scheduleContinuation: (sk, msg) => {
        this.scheduleContinuation(sk, msg, {
          channel: routing.channel,
          chatId: routing.chatId,
          inboundMetadata: routing.inboundMetadata,
        });
      },
      inboundConcurrentDepth: (sk) => this.opts.sessionState.getInboundTurnDepth(sk),
    };
  }

  recordStreamOutcome(sessionKey: string, outcome: { skipPersistentGoalPostTurn: boolean }): void {
    this.opts.sessionState.recordPersistentGoalStreamOutcome(sessionKey, outcome);
  }

  takeStreamOutcome(sessionKey: string): { skipPersistentGoalPostTurn: boolean } | undefined {
    return this.opts.sessionState.takePersistentGoalStreamOutcome(sessionKey);
  }

  /**
   * Run the `/goal` post-turn verdict for a completed user turn (called from
   * `OutboundCoordinator.emitSessionTurnComplete`).
   */
  async runPostTurn(payload: SessionTurnCompletionForGoal): Promise<void> {
    const apis = this.buildApisForRouting({
      sessionKey: payload.sessionKey,
      channel: payload.channel,
      chatId: payload.chatId,
      inboundMetadata: payload.outboundMetadata,
    });

    const src = parseRoutingSessionKey(payload.sessionKey)?.source;
    const isWebchat = src === 'webchat';
    const publishVerdict =
      !isWebchat && payload.channel !== 'cli'
        ? async (text: string) => {
            await this.opts.bus.publishOutbound({
              channel: payload.channel,
              chat_id: payload.chatId,
              content: text,
              type: 'message',
              metadata: {
                accountId: payload.outboundMetadata?.accountId,
                threadId: payload.outboundMetadata?.threadId,
              },
            });
          }
        : undefined;

    let runtimeSessionModelRef: string | undefined;
    try {
      runtimeSessionModelRef = this.opts.modelManager.getModelForSession(payload.sessionKey);
    } catch {
      runtimeSessionModelRef = undefined;
    }

    await handlePersistentGoalPostTurn({
      apis,
      sessionKey: payload.sessionKey,
      assistantPlainText: payload.assistantPlainText,
      aborted: payload.aborted,
      ...(payload.streamError !== undefined ? { streamError: payload.streamError } : {}),
      skipPersistentGoalPostTurn: payload.skipPersistentGoalPostTurn ?? false,
      config: this.opts.getConfig(),
      runtimeSessionModelRef,
      publishVerdictToChannel: publishVerdict,
    });
  }
}
