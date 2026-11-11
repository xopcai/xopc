/**
 * ChannelOutboundSender — single owner of the outbound pipeline:
 *
 *   1. Optional TTS rewrite (`maybeApplyTtsToPayload`)
 *   2. Persist-store enqueue (best-effort durability if a send hangs)
 *   3. Extension `message_sending` hook (block / mutate)
 *   4. Internal-channel drop guard
 *   5. Plugin delivery via `deliverOutboundMessage`
 *   6. Extension `message_sent` hook
 *   7. Persist-store ack
 *
 * Extracted from `ChannelManager.send` so the lifecycle supervisor and plugin
 * registry stay focused on plugin start/stop and lookup. The send pipeline is
 * the highest-traffic path in the channel layer; centralising it makes its
 * error semantics easier to reason about.
 */

import type { InboundDelivery } from '../infra/bus/index.js';
import type { Config } from '../config/schema.js';

import type { OutboundMessage } from './transport-types.js';
import { INTERNAL_OUTBOUND_DROP_CHANNEL } from './internal-outbound.js';
import { mergeTtsConfigFromAppConfig } from '../voice/tts/merge-config.js';
import { maybeApplyTtsToPayload } from '../voice/tts/payload.js';
import { deliverOutboundMessage } from './outbound/deliver.js';
import { ChannelMessageJournal } from './message-journal.js';
import { OutboundPersistStore } from './outbound/persist-store.js';
import type { ChannelPluginRegistry } from './plugin-registry.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('ChannelOutboundSender');

/** Hooks wired from `AgentService` for `message_sending` / `message_sent` on outbound delivery. */
export interface OutboundChannelHooks {
  runMessageSending: (
    to: string,
    content: string,
    channel: string,
  ) => Promise<{ send: boolean; content?: string; reason?: string }>;
  runMessageSent: (
    to: string,
    content: string,
    success: boolean,
    error: string | undefined,
    channel: string,
  ) => Promise<void>;
}

export interface ChannelOutboundSenderOptions {
  registry: ChannelPluginRegistry;
  /** Effective config snapshot (TTS rules + plugin delivery context). */
  getConfig: () => Config;
}

export class ChannelOutboundSender {
  private readonly opts: ChannelOutboundSenderOptions;
  private hooks?: OutboundChannelHooks;
  private persistStore?: OutboundPersistStore;
  private replyJournal?: ChannelMessageJournal<OutboundMessage, never>;
  private replyRecoveryDone = false;
  private readonly replyReceipts = new WeakMap<OutboundMessage, string>();

  constructor(opts: ChannelOutboundSenderOptions) {
    this.opts = opts;
  }

  setHooks(hooks: OutboundChannelHooks): void {
    this.hooks = hooks;
  }

  enablePersistence(agentId: string): void {
    this.persistStore = new OutboundPersistStore(agentId);
    this.replyJournal = new ChannelMessageJournal<OutboundMessage, never>('agent-reply', agentId);
    this.replyRecoveryDone = false;
  }

  persistReply(message: OutboundMessage, delivery: InboundDelivery): boolean {
    if (!this.replyJournal) return true;
    this.recoverInterruptedReplies();
    const id = JSON.stringify([message.channel, delivery.scope, delivery.id]);
    const accepted = this.replyJournal.accept([{ id, payload: message }]).length > 0;
    if (accepted) this.replyReceipts.set(message, id);
    return accepted;
  }

  async sendQueued(message: OutboundMessage): Promise<void> {
    const id = this.replyReceipts.get(message);
    if (!id || !this.replyJournal) {
      await this.send(message);
      return;
    }
    this.replyReceipts.delete(message);
    await this.dispatchReply(id, message);
  }

  private async dispatchReply(id: string, message: OutboundMessage): Promise<void> {
    const journal = this.replyJournal;
    if (!journal?.begin(id)) return;
    try {
      await this.send(message, { skipPersist: true, requireDelivery: true });
    } catch {
      journal.finish(id, 'interrupted');
      log.warn({ channel: message.channel, deliveryId: id }, 'Channel reply delivery could not be confirmed');
      return;
    }
    journal.finish(id, 'completed');
  }

  private recoverInterruptedReplies(): void {
    if (!this.replyJournal || this.replyRecoveryDone) return;
    const interrupted = this.replyJournal.recoverInterrupted();
    this.replyRecoveryDone = true;
    if (interrupted) log.warn({ interrupted }, 'Channel replies interrupted during delivery');
  }

  /**
   * Redeliver every queued outbound item (called after channels are started).
   * Best-effort — may duplicate if the prior send succeeded but ack did not
   * land on disk.
   */
  async replayPending(): Promise<void> {
    const journal = this.replyJournal;
    if (journal) {
      this.recoverInterruptedReplies();
      for (const { id, payload } of journal.pending(500)) {
        await this.dispatchReply(id, payload);
      }
    }
    if (!this.persistStore) return;
    const pending = [...this.persistStore.peek()];
    for (const p of pending) {
      try {
        await this.send(p.message, { skipPersist: true });
        this.persistStore.ack(p.id);
      } catch (err) {
        log.error({ id: p.id, err }, 'Failed to replay outbound message');
      }
    }
  }

  async send(msg: OutboundMessage, options?: { skipPersist?: boolean; requireDelivery?: boolean }): Promise<void> {
    log.debug({ type: msg.type, channel: msg.channel, chatId: msg.chat_id }, 'Received outbound message');

    let processedMsg = await this.applyTtsIfNeeded(msg);
    const queueId =
      !options?.skipPersist && this.persistStore
        ? this.persistStore.enqueue(structuredClone(processedMsg))
        : null;

    try {
      if (this.hooks) {
        const hookResult = await this.hooks.runMessageSending(
          processedMsg.chat_id,
          processedMsg.content ?? '',
          processedMsg.channel,
        );
        if (!hookResult.send) {
          if (options?.requireDelivery) throw new Error('Channel delivery was blocked by policy.');
          if (queueId) this.persistStore!.ack(queueId);
          return;
        }
        processedMsg = { ...processedMsg, content: hookResult.content ?? processedMsg.content };
      }

      if (processedMsg.channel === INTERNAL_OUTBOUND_DROP_CHANNEL) {
        log.debug(
          { chatId: processedMsg.chat_id },
          'Outbound dropped (internal session — not a real channel)',
        );
        if (queueId) this.persistStore!.ack(queueId);
        return;
      }

      const plugin = this.opts.registry.get(processedMsg.channel);
      if (!plugin?.outbound) {
        if (options?.requireDelivery) throw new Error('The requested channel is unavailable.');
        log.error({ channel: processedMsg.channel }, 'Unknown channel or no outbound adapter');
        if (queueId) this.persistStore!.ack(queueId);
        return;
      }

      const result = await deliverOutboundMessage({
        cfg: this.opts.getConfig(),
        plugin,
        processedMsg,
      });

      if (this.hooks) {
        const err = result && !result.success ? result.error : undefined;
        await this.hooks.runMessageSent(
          processedMsg.chat_id,
          processedMsg.content ?? '',
          result?.success ?? false,
          err,
          processedMsg.channel,
        );
      }

      if (options?.requireDelivery && !result?.success) throw new Error('Channel delivery did not succeed.');
      if (!result) {
        if (queueId) this.persistStore!.ack(queueId);
        return;
      }

      if (result.success) {
        log.info(
          { channel: processedMsg.channel, chatId: processedMsg.chat_id, messageId: result.messageId },
          'Message sent',
        );
      } else {
        log.error(
          { channel: processedMsg.channel, chatId: processedMsg.chat_id, error: result.error },
          'Failed to send message',
        );
      }

      if (queueId) this.persistStore!.ack(queueId);
    } catch (err) {
      log.error(
        { channel: processedMsg.channel, chatId: processedMsg.chat_id, err },
        'Outbound send threw',
      );
      // No queueId means the persist-store was never engaged — caller is responsible for retrying.
      if (!queueId || options?.requireDelivery) throw err;
    }
  }

  private async applyTtsIfNeeded(msg: OutboundMessage): Promise<OutboundMessage> {
    if (msg.type && msg.type !== 'message') return msg;
    if (!msg.content?.trim()) return msg;
    if (msg.mediaUrl) return msg;

    const cfg = this.opts.getConfig();
    const ttsConfig = mergeTtsConfigFromAppConfig(cfg.messages?.tts);
    if (!ttsConfig.enabled) return msg;

    const inboundAudio = msg.metadata?.transcribedVoice === true;
    return maybeApplyTtsToPayload(msg, {
      config: ttsConfig,
      channel: msg.channel,
      inboundAudio,
      appConfig: cfg,
    });
  }
}
