/**
 * OutboundCoordinator — owns the post-turn outbound pipeline.
 *
 * Concentrates the responsibilities that used to be scattered across
 * `AgentService`:
 *  - typing-on / typing-off lifecycle for channels that surface "is typing…"
 *  - final assistant response delivery (silence guard + hook + bus publish)
 *  - cross-cutting `webchat_turn_complete` hook + task review
 *  - thin pass-through for extension `message_sending` / `message_sent` hooks
 *
 * The class is intentionally framework-agnostic: it pulls everything it needs
 * via the constructor config (no direct AgentService reference), so it is
 * unit-testable and lets the parent `AgentService` shrink to a coordinator.
 */

import type { MessageBus, InboundMessage } from '../../infra/bus/index.js';
import type { Config } from '../../config/schema.js';
import type { HookHandler } from '../lifecycle/hook-handler.js';
import type { SessionContext } from '../session/index.js';
import { createTypingController, type TypingController } from '../lifecycle/typing.js';
import { DEFAULT_ACK_MAX_CHARS, NO_REPLY, shouldSilence } from '../../heartbeat/tokens.js';
import { createLogger } from '../../utils/logger.js';
import type { StreamManager } from './stream-manager.js';

const log = createLogger('OutboundCoordinator');

export interface OutboundCoordinatorConfig {
  bus: MessageBus;
  hookHandler: HookHandler;
  streamManager: StreamManager;
  /** Reads the effective config snapshot (honours runtime overrides). */
  getConfig: () => Config | undefined;
  /** Resolves the last visible assistant text for a session (in-memory + agent fallback). */
  getLastAssistantPlainText: (sessionKey: string) => string;
  reviewTaskTurn: (payload: SessionTurnCompletePayload) => Promise<void>;
}

export interface SessionTurnCompletePayload {
  sessionKey: string;
  channel: string;
  chatId: string;
  inboundUserText: string;
  assistantPlainText: string;
  aborted: boolean;
  streamError?: string;
  skipTaskReview?: boolean;
  outboundMetadata?: Record<string, unknown>;
}

export class OutboundCoordinator {
  private readonly bus: MessageBus;
  private readonly hookHandler: HookHandler;
  private readonly streamManager: StreamManager;
  private readonly getConfig: () => Config | undefined;
  private readonly getLastAssistantPlainText: (sessionKey: string) => string;
  private readonly reviewTaskTurn: OutboundCoordinatorConfig['reviewTaskTurn'];

  constructor(config: OutboundCoordinatorConfig) {
    this.bus = config.bus;
    this.hookHandler = config.hookHandler;
    this.streamManager = config.streamManager;
    this.getConfig = config.getConfig;
    this.getLastAssistantPlainText = config.getLastAssistantPlainText;
    this.reviewTaskTurn = config.reviewTaskTurn;
  }

  /**
   * Build the typing indicator controller for an inbound message. Returns
   * `null` for the CLI channel (no typing UI). Caller is responsible for
   * `start()` and `stop()` (`stop()` should run AFTER the final outbound so
   * Telegram/Weixin see `typing_off` only once the message is delivered).
   */
  createTypingControllerForInbound(msg: InboundMessage): TypingController | null {
    if (msg.channel === 'cli') {
      return null;
    }
    const meta = msg.metadata as Record<string, unknown> | undefined;
    return createTypingController({
      intervalSeconds: 5,
      onStart: async () => {
        await this.bus.publishOutbound({
          channel: msg.channel,
          chat_id: msg.chat_id,
          content: '',
          type: 'typing_on',
          metadata: {
            accountId: meta?.accountId,
            threadId: meta?.threadId,
            sessionWebhook: meta?.sessionWebhook,
            conversationId: meta?.conversationId,
          },
        });
      },
      onStop: async () => {
        await this.bus.publishOutbound({
          channel: msg.channel,
          chat_id: msg.chat_id,
          content: '',
          type: 'typing_off',
          metadata: {
            accountId: meta?.accountId,
            threadId: meta?.threadId,
            sessionWebhook: meta?.sessionWebhook,
            conversationId: meta?.conversationId,
          },
        });
      },
    });
  }

  /**
   * Publish the assistant's visible text as the final bus message. Honours the
   * stream-manager "channel already streamed the final text" hint, the heartbeat
   * silence guard, and the extension `message_sending` hook.
   */
  async sendFinalResponse(msg: InboundMessage, sessionContext: SessionContext): Promise<void> {
    if (this.streamManager.consumeSkipFinalOutbound()) {
      return;
    }

    const finalContent = this.getLastAssistantPlainText(sessionContext.sessionKey);
    if (!finalContent?.trim()) {
      return;
    }

    const ackMax = this.getConfig()?.gateway?.heartbeat?.ackMaxChars ?? DEFAULT_ACK_MAX_CHARS;
    if (shouldSilence(finalContent, ackMax) || finalContent.trim() === NO_REPLY) {
      log.debug({ sessionKey: sessionContext.sessionKey }, 'Silent reply — skipping outbound');
      return;
    }

    const hookResult = await this.hookHandler.runMessageSending(
      sessionContext.chatId,
      finalContent,
      sessionContext.channel,
    );
    if (!hookResult.send) {
      return;
    }

    await this.bus.publishOutbound({
      channel: sessionContext.channel,
      chat_id: sessionContext.chatId,
      content: hookResult.content || finalContent,
      type: 'message',
      metadata: {
        accountId: msg.metadata?.accountId,
        threadId: msg.metadata?.threadId,
        inboundMessageId: msg.metadata?.messageId,
        transcribedVoice: sessionContext.metadata?.transcribedVoice,
        sessionWebhook: msg.metadata?.sessionWebhook,
        conversationId: msg.metadata?.conversationId,
      },
    });
  }

  /** Run extension completion hooks and independently review an attached Task. */
  async emitSessionTurnComplete(payload: SessionTurnCompletePayload): Promise<void> {
    await this.hookHandler.triggerWithSessionKey(payload.sessionKey, 'webchat_turn_complete', {
      sessionKey: payload.sessionKey,
      channel: payload.channel,
      chatId: payload.chatId,
      inboundUserText: payload.inboundUserText,
      assistantPlainText: payload.assistantPlainText,
      aborted: payload.aborted,
      ...(payload.streamError !== undefined ? { streamError: payload.streamError } : {}),
    });

    await this.reviewTaskTurn(payload);
  }

  /** Extension hook pass-through (Gateway ChannelManager). */
  invokeOutboundMessageSending(
    to: string,
    content: string,
    channel: string,
  ): Promise<{ send: boolean; content?: string; reason?: string }> {
    return this.hookHandler.runMessageSending(to, content, channel);
  }

  /** Extension hook pass-through (Gateway ChannelManager). */
  invokeOutboundMessageSent(
    to: string,
    content: string,
    success: boolean,
    error: string | undefined,
    channel: string,
  ): Promise<void> {
    return this.hookHandler.runMessageSent(to, content, success, error, channel);
  }
}
