/**
 * TurnDispatcher — single entry point for direct (non-bus) agent turns.
 *
 * Wraps the two existing direct-turn runners (one-shot and streaming) so the
 * parent `AgentService` no longer carries a pair of huge `createXxxDeps()`
 * factories. The public surface — `processDirect`, `processDirectStreaming`,
 * `steerWebchatSession`, `enqueueWebchatSseEvent`,
 * `notifyWebchatTranscriptAppend` — matches what `AgentService` exposed
 * previously, so callers (gateway, CLI) are unchanged.
 *
 * Like `OutboundCoordinator` and `InboundLoop`, this class accepts a wide
 * dependency bag in its constructor (the direct-turn pipeline touches almost
 * every other subsystem). The win is that AgentService becomes the only place
 * that wires those dependencies together; individual responsibilities now live
 * in their own classes and are unit-testable.
 */

import type { Config } from '../../config/schema.js';
import type { ContextualLogger } from '../../utils/logger/types.js';

import type { AgentManager } from '../agent-manager.js';
import type { CommandHandler } from '../messaging/command-handler.js';
import type { ModelManager } from '../models/index.js';
import type { SessionConfigStore } from '../../session/index.js';
import type { SessionStore } from '../../session/store.js';
import type {
  SessionContext,
  SessionHydrator,
  SessionStateBag,
} from '../session/index.js';
import { queueEmbeddedSteer } from '../embedded/runs.js';
import type {
  InboundAttachmentInput,
  MediaRef,
} from '../../channels/attachments/inbound-persist.js';
import {
  buildDirectUserMessageContent,
} from '../service/build-direct-message-content.js';
import {
  runProcessDirectStreaming,
  type ProcessDirectStreamingDeps,
  type ProcessDirectStreamingSseEvent,
} from '../service/process-direct-streaming.js';
import {
  runProcessDirect,
  type RunProcessDirectDeps,
} from '../service/process-direct-one-shot.js';
import { maybeEmitWebchatTts } from '../service/webchat-tts.js';
import type { AgentSourceContextResolver } from '../source-context/types.js';

export interface TurnDispatcherConfig {
  log: ContextualLogger;
  agentManager: AgentManager;
  sessionStore: SessionStore;
  modelManager: ModelManager;
  sessionConfigStore: SessionConfigStore;
  sessionState: SessionStateBag;
  commandHandler: CommandHandler;
  getConfig: () => Config | undefined;
  /** Strict accessor — required for direct-turn paths that must have a config. */
  requireConfig: () => Config;
  resolveSessionEndpoint: (sessionKey: string) => Promise<{ channel: string; chatId: string }>;
  /** Establish per-session context (also creates the Agent + subscribes to events). */
  initSessionContext: (sessionKey: string, channel: string, chatId: string) => SessionContext;
  /** Per-session config hydration: workspace, model, thinking. */
  sessionHydrator: SessionHydrator;
  prepareInboundAttachments: (
    sessionKey: string,
    attachments?: InboundAttachmentInput[],
  ) => Promise<MediaRef[] | undefined>;
  enqueueMaybeAutoTitleAfterPersist: (sessionKey: string) => void;
  enqueueProvisionalSessionTitle?: (sessionKey: string, userText: string) => void;
  endDirectRequestContext: () => void;
  /** Gateway hook fired after assistant text lands on disk (UI refetch). */
  onSessionTranscriptUpdated?: (sessionKey: string) => void;
  resetSession: (sessionKey: string) => Promise<{ sessionId: string; previousSessionId: string } | null>;
  sourceContextResolver?: AgentSourceContextResolver;
}

export type DirectAttachment = InboundAttachmentInput;

export interface ProcessDirectOptions {
  signal?: AbortSignal;
  runId?: string;
  deadlineAtMs?: number;
}

export class TurnDispatcher {
  private readonly cfg: TurnDispatcherConfig;
  private readonly log: ContextualLogger;

  constructor(cfg: TurnDispatcherConfig) {
    this.cfg = cfg;
    this.log = cfg.log;
  }

  /** One-shot direct turn (CLI / embedded TUI). */
  processDirect(
    content: string,
    sessionKey = 'agent:main:main',
    attachments?: DirectAttachment[],
    thinking?: string,
    options?: ProcessDirectOptions,
  ): Promise<string> {
    return runProcessDirect(this.buildOneShotDeps(), {
      content,
      sessionKey,
      attachments,
      thinking,
      signal: options?.signal,
      runId: options?.runId,
      deadlineAtMs: options?.deadlineAtMs,
    });
  }

  /** Streaming direct turn (webchat SSE / CLI streaming). */
  async *processDirectStreaming(
    content: string,
    sessionKey = 'agent:main:main',
    attachments?: DirectAttachment[],
    thinking?: string,
    options?: { signal?: AbortSignal; runId?: string },
  ): AsyncGenerator<ProcessDirectStreamingSseEvent, void, unknown> {
    yield* runProcessDirectStreaming(this.buildStreamingDeps(), {
      content,
      sessionKey,
      attachments,
      thinking,
      signal: options?.signal,
      runId: options?.runId,
    });
  }

  /** Push an out-of-band event into the live webchat stream for a session. */
  enqueueWebchatSseEvent(
    sessionKey: string,
    event: { type: string; [key: string]: unknown },
  ): void {
    const pub = this.cfg.sessionState.getWebchatPublisher(sessionKey);
    if (pub) {
      pub(event);
    }
  }

  /** Stream assistant text to live webchat session + notify transcript listeners. */
  notifyWebchatTranscriptAppend(sessionKey: string, assistantText: string): void {
    const trimmed = assistantText.trim();
    if (trimmed) {
      const message = {
        role: 'assistant',
        content: [{ type: 'text', text: trimmed }],
        timestamp: Date.now(),
      };
      this.enqueueWebchatSseEvent(sessionKey, { type: 'message_start', message });
      this.enqueueWebchatSseEvent(sessionKey, { type: 'message_update', message });
      this.enqueueWebchatSseEvent(sessionKey, { type: 'message_end', message });
    }
    this.cfg.onSessionTranscriptUpdated?.(sessionKey);
  }

  /**
   * Queue a steering user message into pi-agent's in-flight run (delivered
   * after current tool work, before the next LLM call). See `Agent.steer`
   * in `@earendil-works/pi-agent-core`.
   */
  async steerWebchatSession(sessionKey: string, text: string): Promise<boolean> {
    const trimmed = text.trim();
    if (!trimmed) return false;
    try {
      return await queueEmbeddedSteer(sessionKey, trimmed);
    } catch (err) {
      this.log.warn({ err, sessionKey }, 'steerWebchatSession failed');
      return false;
    }
  }

  private buildStreamingDeps(): ProcessDirectStreamingDeps {
    const c = this.cfg;
    return {
      log: this.log,
      resolveSessionEndpoint: c.resolveSessionEndpoint,
      initDirectStreamingSession: c.initSessionContext,
      registerWebchatSsePublisher: (sk, publisher) =>
        c.sessionState.registerWebchatPublisher(sk, publisher),
      unregisterWebchatSsePublisher: (sk) => c.sessionState.unregisterWebchatPublisher(sk),
      agentManager: c.agentManager,
      hydrateSessionWorkspaceFromStore: (sk) => c.sessionHydrator.workspace(sk),
      hydrateSessionModelFromStore: (sk) => c.sessionHydrator.model(sk),
      sessionStore: c.sessionStore,
      modelManager: c.modelManager,
      applyResolvedThinkingLevel: (sk, t) => c.sessionHydrator.thinking(sk, t),
      getConfig: c.getConfig,
      sessionConfigStore: c.sessionConfigStore,
      commandHandler: c.commandHandler,
      prepareInboundAttachments: c.prepareInboundAttachments,
      buildTranscriptUserMessage: async (text, prepared, sk) =>
        buildDirectUserMessageContent({
          content: text,
          attachments: prepared,
          sessionKey: sk,
          config: c.requireConfig(),
          agentManager: c.agentManager,
          modelManager: c.modelManager,
        }),
      recordTaskReviewStreamHint: (sk, o) =>
        c.sessionState.recordTaskReviewStreamHint(sk, o),
      enqueueProvisionalSessionTitle: (sk, userText) => {
        c.enqueueProvisionalSessionTitle?.(sk, userText);
      },
      onTurnComplete: (sk, text) => {
        if (text) {
          c.sessionState.setLastAssistantText(sk, text);
        }
        c.enqueueMaybeAutoTitleAfterPersist(sk);
      },
      reloadWebchatTranscript: (sk) => {
        c.onSessionTranscriptUpdated?.(sk);
      },
      sourceContextResolver: c.sourceContextResolver,
      maybeEmitWebchatTts: (sk, hadVoice) =>
        maybeEmitWebchatTts(
          {
            config: c.getConfig(),
            sessionStore: c.sessionStore,
            getLastAssistantPlainText: (sessionKey) =>
              c.sessionState.getLastAssistantText(sessionKey) ??
              c.agentManager.getLastAssistantContent(sessionKey) ??
              '',
            log: this.log,
          },
          sk,
          hadVoice,
        ),
      endDirectRequestContext: c.endDirectRequestContext,
      resetSession: c.resetSession,
    };
  }

  private buildOneShotDeps(): RunProcessDirectDeps {
    const c = this.cfg;
    const cfg = c.requireConfig();
    return {
      log: this.log,
      config: cfg,
      resolveSessionEndpoint: c.resolveSessionEndpoint,
      initSessionContext: (sk, channel, chatId) => {
        void c.initSessionContext(sk, channel, chatId);
      },
      hydrateSessionWorkspaceFromStore: (sk) => c.sessionHydrator.workspace(sk),
      hydrateSessionModelFromStore: (sk) => c.sessionHydrator.model(sk),
      agentManager: c.agentManager,
      sessionStore: c.sessionStore,
      modelManager: c.modelManager,
      applyResolvedThinkingLevel: (sk, t) => c.sessionHydrator.thinking(sk, t),
      prepareInboundAttachments: c.prepareInboundAttachments,
      commandHandler: c.commandHandler,
      onTurnComplete: (sk, text) => {
        if (text) {
          c.sessionState.setLastAssistantText(sk, text);
        }
        c.enqueueMaybeAutoTitleAfterPersist(sk);
      },
      endDirectRequestContext: c.endDirectRequestContext,
      resetSession: c.resetSession,
    };
  }
}
