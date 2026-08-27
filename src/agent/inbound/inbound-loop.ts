/**
 * InboundLoop — owns the bus-driven inbound pipeline.
 *
 * Replaces the previous `AgentService.start()` while-loop, `handleInboundMessage`,
 * and `handleSystemMessage` methods. Everything that "a message arrives, run the
 * agent turn, publish the reply" needs is concentrated here; the parent
 * `AgentService` now just constructs the loop with collaborators and forwards
 * start/stop to it.
 *
 * The constructor takes a fairly wide config because handling a single inbound
 * message touches almost every subsystem (router, command handler, lifecycle
 * manager, agent orchestrator, outbound coordinator, session state, etc.). All
 * dependencies are injected so this class is unit-testable and the inbound
 * pipeline can evolve without touching `AgentService`.
 */

import type { AgentMessage } from '@earendil-works/pi-agent-core';

import type { MessageBus, InboundMessage } from '../../infra/bus/index.js';
import { MessageBusShutdownError } from '../../infra/bus/index.js';
import type { Config } from '../../config/schema.js';
import type { ChannelManager } from '../../channels/manager.js';
import { runWithLogContext, updateAsyncLogContext } from '../../utils/logger.js';
import type { ContextualLogger } from '../../utils/logger/types.js';

import type { AgentManager } from '../agent-manager.js';
import type { AgentOrchestrator } from '../orchestration/index.js';
import type { CommandHandler, OutboundCoordinator, StreamManager } from '../messaging/index.js';
import type { MessageRouter } from '../messaging/message-router.js';
import type { ModelManager } from '../models/index.js';
import type {
  SessionContext,
  SessionContextManager,
  SessionHydrator,
  SessionLifecycleManager,
  SessionStateBag,
} from '../session/index.js';
import type { HookHandler } from '../lifecycle/hook-handler.js';
import type { SessionStore } from '../../session/store.js';
import { initSessionTurn } from '../../session/init-session-turn.js';
import { shouldSkipResetOverlapCommand } from '../../session/reset-triggers.js';
import type { StreamHandle } from '../service.types.js';
import { runEmbeddedTurnForSession } from '../embedded/run-for-session.js';
import { inboundMessageLogRequestId } from '../service-inbound-utils.js';

/** Initial back-off when bus consume fails. Doubles each consecutive failure. */
const INBOUND_CONSUME_BASE_BACKOFF_MS = 1_000;
/** Hard cap on back-off so a long bus outage settles at one retry per 30s. */
const INBOUND_CONSUME_MAX_BACKOFF_MS = 30_000;

export interface InboundLoopConfig {
  log: ContextualLogger;
  agentId: string;
  bus: MessageBus;
  hookHandler: HookHandler;
  messageRouter: MessageRouter;
  commandHandler: CommandHandler;
  sessionContextManager: SessionContextManager;
  agentManager: AgentManager;
  sessionLifecycleManager: SessionLifecycleManager;
  agentOrchestrator: AgentOrchestrator;
  outboundCoordinator: OutboundCoordinator;
  streamManager: StreamManager;
  sessionState: SessionStateBag;
  sessionStore: SessionStore;
  modelManager: ModelManager;

  /** Register a per-session agent-event subscription (idempotent). */
  setupSessionEventHandling: (sessionKey: string) => void;
  /** Per-session config hydration (workspace + model override) before a turn runs. */
  sessionHydrator: SessionHydrator;
  /** Returns the visible last assistant text used for outbound delivery. */
  getLastAssistantPlainText: (sessionKey: string) => string;
  /** Pre-turn auto-compaction (only used by system messages). */
  /** Fire-and-forget auto-title (no-ops for cron/heartbeat keys). */
  enqueueMaybeAutoTitleAfterPersist: (sessionKey: string) => void;
  /** Effective merged config snapshot. */
  getConfig: () => Config | undefined;
  /** Archive transcript + new session id (freshness / reset trigger rollover). */
  resetSession: (sessionKey: string) => Promise<{ sessionId: string; previousSessionId: string } | null>;
  /** Connect a channel stream handle for partial assistant text rendering. */
  setStreamHandle: (handle: StreamHandle) => void;
}

export class InboundLoop {
  private readonly cfg: InboundLoopConfig;
  private readonly log: ContextualLogger;
  private running = false;
  private channelManagerRef: ChannelManager | null = null;

  constructor(cfg: InboundLoopConfig) {
    this.cfg = cfg;
    this.log = cfg.log;
  }

  setChannelManager(channelManager: ChannelManager | null): void {
    this.channelManagerRef = channelManager;
  }

  isRunning(): boolean {
    return this.running;
  }

  /** Begin consuming inbound messages from the bus until {@link stop} or shutdown. */
  async start(): Promise<void> {
    this.running = true;
    await this.cfg.hookHandler.trigger('session_start', { sessionId: this.cfg.agentId });

    // Errors fall into two buckets:
    //   1. `bus.consumeInbound()` itself threw → infrastructure problem; back off
    //      exponentially so a flapping bus does not pin the CPU at 100%.
    //   2. `handleInboundMessage(msg)` threw → per-message handler bug. The
    //      message is already lost; do NOT sleep, just log and move on so
    //      legitimate traffic is not held hostage.
    // Shutdown (`MessageBusShutdownError`) is the only signal that breaks the loop.
    let consecutiveConsumeFailures = 0;

    while (this.running) {
      let msg: InboundMessage;
      try {
        msg = await this.cfg.bus.consumeInbound();
        consecutiveConsumeFailures = 0;
      } catch (error) {
        if (error instanceof MessageBusShutdownError) {
          break;
        }
        consecutiveConsumeFailures += 1;
        const delayMs = Math.min(
          INBOUND_CONSUME_MAX_BACKOFF_MS,
          INBOUND_CONSUME_BASE_BACKOFF_MS * 2 ** (consecutiveConsumeFailures - 1),
        );
        const em = error instanceof Error ? error.message : String(error);
        this.log.error(
          {
            err: error,
            errorMessage: em,
            phase: 'inbound_consume',
            consecutiveFailures: consecutiveConsumeFailures,
            backoffMs: delayMs,
          },
          `Bus consume failed (backing off ${delayMs}ms): ${em}`,
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }

      try {
        await this.handleInboundMessage(msg);
      } catch (error) {
        const em = error instanceof Error ? error.message : String(error);
        this.log.error(
          {
            err: error,
            errorMessage: em,
            phase: 'inbound_handle',
            channel: msg.channel,
            chatId: msg.chat_id,
          },
          `Inbound message handler failed: ${em}`,
        );
        // Per-message failure: keep consuming. The next message is independent.
      }
    }

    await this.cfg.hookHandler.trigger('session_end', {
      sessionId: this.cfg.agentId,
      messageCount: 0,
    });
  }

  /** Cooperatively stop the loop; the current message (if any) is allowed to finish. */
  stop(): void {
    this.running = false;
  }

  private async handleInboundMessage(msg: InboundMessage): Promise<void> {
    const requestId = inboundMessageLogRequestId(msg);

    await runWithLogContext({ requestId }, async () => {
      const routing = await this.cfg.messageRouter.routeMessage(msg);
      const { context, isCommand, command, commandArgs } = routing;

      const sessionContext: SessionContext = {
        sessionKey: context.sessionKey,
        channel: context.channel,
        chatId: context.chatId,
        senderId: context.senderId || '',
        isGroup: context.isGroup || false,
        origin: { type: 'channel', channel: context.channel },
        metadata: {
          transcribedVoice: msg.metadata?.transcribedVoice === true,
        },
      };

      const sessionMetadata = await this.cfg.sessionStore.getMetadata(sessionContext.sessionKey).catch(() => null);
      updateAsyncLogContext({
        sessionKey: sessionContext.sessionKey,
        ...(sessionMetadata?.sessionId ? { sessionId: sessionMetadata.sessionId } : {}),
      });

      await this.cfg.sessionContextManager.runWith(sessionContext, async () => {
        // `subscribeToSession` requires an Agent instance; without this the first inbound never
        // registers `message_update` streaming (second turn behaved differently).
        this.cfg.agentManager.getOrCreateAgent(sessionContext.sessionKey);
        this.cfg.setupSessionEventHandling(sessionContext.sessionKey);

        await this.cfg.sessionLifecycleManager.startSession(sessionContext);

        let typingController: ReturnType<OutboundCoordinator['createTypingControllerForInbound']> = null;
        let inboundTurnArmed = false;
        let busProcessFailed: string | undefined;
        let inboundMsg = msg;

        try {
          if (msg.channel === 'system') {
            await this.handleSystemMessage(msg, sessionContext);
            return;
          }

          if (this.channelManagerRef && msg.channel !== 'cli') {
            await this.channelManagerRef.dispatchInboundMessageAction(msg);
          }

          const cfg = this.cfg.getConfig();
          let effectiveContent = msg.content;
          let resetTriggeredAtInit = false;

          if (cfg && typeof msg.content === 'string') {
            const turn = await initSessionTurn({
              cfg,
              sessionKey: sessionContext.sessionKey,
              body: msg.content,
              resetSession: (sk) => this.cfg.resetSession(sk),
            });
            resetTriggeredAtInit = turn.resetTriggered;

            if (turn.bareReset && turn.ackMessage) {
              await this.cfg.bus.publishOutbound({
                channel: sessionContext.channel,
                chat_id: sessionContext.chatId,
                content: turn.ackMessage,
                type: 'message',
              });
              return;
            }

            effectiveContent = turn.bodyStripped;
          }

          if (isCommand && command) {
            if (!shouldSkipResetOverlapCommand(command, resetTriggeredAtInit)) {
              const handled = await this.cfg.commandHandler.executeCommand(command, commandArgs || '', {
                sessionKey: sessionContext.sessionKey,
                channel: sessionContext.channel,
                chatId: sessionContext.chatId,
                senderId: sessionContext.senderId,
                isGroup: sessionContext.isGroup,
                inboundMetadata: msg.metadata,
              });
              if (handled) {
                return;
              }
            }
          }

          inboundMsg =
            effectiveContent !== msg.content ? { ...msg, content: effectiveContent } : msg;

          // Continuous typing indicator (renews every 5 seconds); stopped only AFTER outbound.
          typingController = this.cfg.outboundCoordinator.createTypingControllerForInbound(msg);
          typingController?.start();

          if (this.channelManagerRef && msg.channel !== 'cli') {
            const meta = msg.metadata as Record<string, unknown> | undefined;
            const streamHandle = this.channelManagerRef.startStream(
              msg.channel,
              msg.chat_id,
              meta?.accountId as string | undefined,
              {
                threadId: meta?.threadId as string | undefined,
                replyToMessageId: meta?.messageId as string | undefined,
              },
            );
            if (streamHandle) {
              this.cfg.setStreamHandle(streamHandle as StreamHandle);
            }
          }

          this.cfg.sessionState.beginInboundTurn(sessionContext.sessionKey);
          inboundTurnArmed = true;
          try {
            await this.cfg.agentOrchestrator.process(inboundMsg, sessionContext);
          } catch (procErr) {
            busProcessFailed = procErr instanceof Error ? procErr.message : String(procErr);
            throw procErr;
          }
        } finally {
          await this.cfg.sessionLifecycleManager.endSession(sessionContext);
          await this.cfg.streamManager.end();
          try {
            await this.cfg.outboundCoordinator.sendFinalResponse(msg, sessionContext);
          } finally {
            // Clear typing AFTER outbound (incl. TTS); otherwise Weixin shows typing_off before the message.
            await typingController?.stop();
          }
          if (inboundTurnArmed) {
            const meta = msg.metadata as Record<string, unknown> | undefined;
            const assistantPlainText = this.cfg.getLastAssistantPlainText(sessionContext.sessionKey) ?? '';
            try {
              await this.cfg.outboundCoordinator.emitSessionTurnComplete({
                sessionKey: sessionContext.sessionKey,
                channel: sessionContext.channel,
                chatId: sessionContext.chatId,
                inboundUserText: inboundMsg.content,
                assistantPlainText,
                aborted: false,
                ...(busProcessFailed !== undefined ? { streamError: busProcessFailed } : {}),
                skipTaskReview: false,
                outboundMetadata: {
                  accountId: meta?.accountId,
                  threadId: meta?.threadId,
                },
              });
            } catch (turnErr) {
              const em = turnErr instanceof Error ? turnErr.message : String(turnErr);
              this.log.warn(
                { err: turnErr, sessionKey: sessionContext.sessionKey },
                `Session turn complete failed: ${em}`,
              );
            }
            this.cfg.sessionState.endInboundTurn(sessionContext.sessionKey);
          }
        }
      });
    });
  }

  private async handleSystemMessage(msg: InboundMessage, context: SessionContext): Promise<void> {
    this.log.debug({ sessionKey: context.sessionKey }, 'Processing system message');

    await this.cfg.sessionHydrator.workspace(context.sessionKey);
    await this.cfg.sessionHydrator.model(context.sessionKey);

    const systemMessage: AgentMessage = {
      role: 'user',
      content: [{ type: 'text', text: `[System: ${msg.sender_id}] ${msg.content}` }],
      timestamp: Date.now(),
    };

    try {
      const result = await runEmbeddedTurnForSession({
        sessionKey: context.sessionKey,
        userMessage: systemMessage,
        sessionStore: this.cfg.sessionStore,
        agentManager: this.cfg.agentManager,
        modelManager: this.cfg.modelManager,
        getConfig: this.cfg.getConfig,
      });

      const finalContent = result.lastAssistantText ?? this.cfg.getLastAssistantPlainText(context.sessionKey);
      if (finalContent) {
        this.cfg.sessionState.setLastAssistantText(context.sessionKey, finalContent);
        const hookResult = await this.cfg.hookHandler.runMessageSending(
          context.chatId,
          finalContent,
          context.channel,
        );
        if (hookResult.send) {
          await this.cfg.bus.publishOutbound({
            channel: context.channel,
            chat_id: context.chatId,
            content: hookResult.content || finalContent,
            type: 'message',
          });
        }
      }
      this.cfg.enqueueMaybeAutoTitleAfterPersist(context.sessionKey);
    } catch (error) {
      const em = error instanceof Error ? error.message : String(error);
      this.log.error(
        {
          err: error,
          errorMessage: em,
          sessionKey: context.sessionKey,
          channel: context.channel,
          chatId: context.chatId,
          senderId: msg.sender_id,
        },
        `System message handling failed: ${em}`,
      );
      await this.cfg.bus.publishOutbound({
        channel: context.channel,
        chat_id: context.chatId,
        content: '❌ An error occurred while processing the system message.',
        type: 'message',
      });
    }
  }
}
