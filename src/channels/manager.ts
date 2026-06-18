/**
 * Channel Manager — thin composition root for the channel subsystem.
 *
 * Wires together the four coordinators that own what used to be the eight
 * concerns of this 707-line class:
 *
 *   - {@link ChannelPluginRegistry}        — plugins Map, register/get
 *   - {@link ChannelLifecycleSupervisor}   — init/start/stop/restart-backoff
 *   - {@link ChannelHeartbeatScheduler}    — per-account heartbeat probes
 *   - {@link ChannelOutboundSender}        — TTS rewrite + persist + delivery
 *
 * The public surface (`registerPlugin`, `initialize`, `start`, `send`, etc.) is
 * preserved so callers (`GatewayService`, CLI commands, channel plugins) are
 * unchanged.
 */

import type { Config } from '../config/schema.js';
import type { MessageBus } from '../infra/bus/index.js';

import type { InboundMessage, OutboundMessage } from './transport-types.js';
import type {
  ChannelPlugin,
  ChannelPluginSessionModelHooks,
  ChannelStreamHandle,
} from './plugin-types.js';
import { ChannelHealthMonitor, type ChannelHealthState } from './health-monitor.js';
import { ChannelPluginRegistry } from './plugin-registry.js';
import { ChannelHeartbeatScheduler } from './heartbeat-scheduler.js';
import {
  ChannelOutboundSender,
  type OutboundChannelHooks,
} from './outbound-sender.js';
import { ChannelLifecycleSupervisor } from './lifecycle-supervisor.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('ChannelManager');

export type { OutboundChannelHooks } from './outbound-sender.js';

export class ChannelManager {
  private config: Config;
  private readonly registry = new ChannelPluginRegistry();
  private readonly healthMonitor = new ChannelHealthMonitor();
  private readonly lifecycle: ChannelLifecycleSupervisor;
  private readonly heartbeat: ChannelHeartbeatScheduler;
  private readonly outbound: ChannelOutboundSender;
  private sessionModelHooks?: ChannelPluginSessionModelHooks;

  constructor(config: Config, bus: MessageBus) {
    this.config = config;

    this.heartbeat = new ChannelHeartbeatScheduler({
      getConfig: () => this.config,
      healthMonitor: this.healthMonitor,
      requestSoftRestart: (channelId) => {
        void this.lifecycle.softRestart(channelId);
      },
    });

    this.lifecycle = new ChannelLifecycleSupervisor({
      bus,
      registry: this.registry,
      getConfig: () => this.config,
      getSessionModelHooks: () => this.sessionModelHooks,
      onPluginStarted: (plugin) => this.heartbeat.schedule(plugin),
      onPluginStopped: (pluginId) => this.heartbeat.clear(pluginId),
    });

    this.outbound = new ChannelOutboundSender({
      registry: this.registry,
      getConfig: () => this.config,
    });
  }

  // ── Wiring hooks (called by GatewayService / cli) ─────────────────────

  setOutboundHooks(hooks: OutboundChannelHooks): void {
    this.outbound.setHooks(hooks);
  }

  /** Call before `initialize()` so plugins can persist per-session model overrides. */
  setSessionModelHooks(hooks: ChannelPluginSessionModelHooks | undefined): void {
    this.sessionModelHooks = hooks;
  }

  enableOutboundPersistence(agentDir: string): void {
    this.outbound.enablePersistence(agentDir);
  }

  // ── Plugin registry pass-throughs ──────────────────────────────────────

  registerPlugin(plugin: ChannelPlugin): void {
    this.registry.register(plugin);
  }

  getPlugin(id: string): ChannelPlugin | undefined {
    return this.registry.get(id);
  }

  getAllPlugins(): ChannelPlugin[] {
    return this.registry.all();
  }

  /** Backward-compat alias for `getAllPlugins`. */
  getAllChannels(): ChannelPlugin[] {
    return this.registry.all();
  }

  /** Channel IDs whose runtime reports connected (e.g. Telegram polling active). */
  getRunningChannels(): string[] {
    return this.registry.runningChannelIds(this.config, (id) => this.lifecycle.isInitialized(id));
  }

  // ── Lifecycle pass-throughs ────────────────────────────────────────────

  initialize(): Promise<void> {
    return this.lifecycle.initialize();
  }

  initializeChannel(channelId: string): Promise<boolean> {
    return this.lifecycle.initializeChannel(channelId);
  }

  start(options?: { deferConnectPluginIds?: ReadonlySet<string> }): Promise<void> {
    return this.lifecycle.start(options);
  }

  startDeferredConnects(): Promise<void> {
    return this.lifecycle.startDeferredConnects();
  }

  async stop(): Promise<void> {
    await this.lifecycle.stop();
    this.heartbeat.clearAll();
  }

  stopChannel(channelId: string): Promise<void> {
    return this.lifecycle.stopChannel(channelId);
  }

  startChannel(channelId: string): Promise<void> {
    return this.lifecycle.startChannel(channelId);
  }

  listDeferConnectChannelIds(cfg: Config): string[] {
    return this.lifecycle.listDeferConnectChannelIds(cfg);
  }

  // ── Outbound pass-throughs ─────────────────────────────────────────────

  send(msg: OutboundMessage, options?: { skipPersist?: boolean }): Promise<void> {
    return this.outbound.send(msg, options);
  }

  replayPendingOutboundMessages(): Promise<void> {
    return this.outbound.replayPending();
  }

  // ── Streaming + status query (delegated to plugin directly) ────────────

  startStream(
    channel: string,
    chatId: string,
    accountId?: string,
    opts?: { threadId?: string; replyToMessageId?: string },
  ): ChannelStreamHandle | null {
    const plugin = this.registry.get(channel);
    if (!plugin) {
      log.error({ channel }, 'Unknown channel');
      return null;
    }
    return (
      plugin.streaming?.startStream?.({
        chatId,
        accountId,
        threadId: opts?.threadId,
        replyToMessageId: opts?.replyToMessageId,
      }) ?? null
    );
  }

  async getChannelStatus(channel: string): Promise<Record<string, unknown>> {
    const plugin = this.registry.get(channel);
    if (!plugin) return { error: 'Unknown channel' };
    if (!plugin.status?.buildChannelSummary) return { status: 'unknown' };

    try {
      const accountId = plugin.config.listAccountIds(this.config)[0] ?? 'default';
      const account = plugin.config.resolveAccount(this.config, accountId);
      return await plugin.status.buildChannelSummary({
        account,
        cfg: this.config,
        defaultAccountId: accountId,
        snapshot: plugin.status.defaultRuntime ?? { accountId, channelId: channel, enabled: true, configured: true },
      });
    } catch (err) {
      return { error: String(err) };
    }
  }

  // ── Inbound action dispatch (Feishu card actions) ──────────────────────

  /**
   * Optional channel hook before `AgentService` consumes an inbound message
   * (e.g. Feishu card-action triggers).
   */
  async dispatchInboundMessageAction(msg: InboundMessage): Promise<void> {
    const plugin = this.registry.get(msg.channel);
    const handle = plugin?.actions?.handleAction;
    if (!handle) return;

    const meta = msg.metadata as Record<string, unknown> | undefined;
    if (msg.channel !== 'feishu' || meta?.feishuEventType !== 'card.action.trigger') {
      return;
    }

    const cardAction = meta.cardAction as Record<string, unknown> | undefined;
    const actionTag =
      cardAction && typeof cardAction.tag === 'string' && cardAction.tag.trim()
        ? cardAction.tag.trim()
        : 'feishu.card_action';
    const cardCtx = meta.cardContext as Record<string, unknown> | undefined;
    const openMsg =
      cardCtx && typeof cardCtx.open_message_id === 'string' ? cardCtx.open_message_id.trim() : '';
    const fallbackMsgId = typeof meta.messageId === 'string' ? meta.messageId.trim() : '';
    const messageId = openMsg || fallbackMsgId;
    const accountId =
      typeof meta.accountId === 'string' && meta.accountId.trim() ? meta.accountId.trim() : 'default';

    try {
      await handle({
        action: actionTag,
        data: JSON.stringify({
          cardAction: meta.cardAction,
          cardContext: meta.cardContext,
          cardActionText: meta.cardActionText,
        }),
        messageId,
        senderId: msg.sender_id,
        chatId: msg.chat_id,
        accountId,
        metadata: {
          feishuEventType: meta.feishuEventType,
          raw: meta.raw,
          sessionKey: meta.sessionKey,
          userContent: msg.content,
        },
      });
    } catch (err) {
      const em = err instanceof Error ? err.message : String(err);
      log.error({ err, channel: msg.channel, accountId, em }, 'dispatchInboundMessageAction failed');
    }
  }

  // ── Config + introspection ─────────────────────────────────────────────

  async updateConfig(config: Config): Promise<void> {
    this.config = config;
    await this.lifecycle.forwardConfigUpdate(config);
    log.info('Channel config updated');
  }

  /** Replace in-memory config without running plugin `onConfigUpdated` hooks. */
  setRuntimeConfig(config: Config): void {
    this.config = config;
  }

  getRuntimeSnapshot(): {
    initialized: boolean;
    running: boolean;
    pluginIds: string[];
    initializedPluginIds: string[];
    manuallyStopped: string[];
    restartAttempts: Record<string, number>;
    channelHealth: Record<string, ChannelHealthState>;
  } {
    const lifecycleSnap = this.lifecycle.snapshot();
    return {
      ...lifecycleSnap,
      pluginIds: this.registry.ids(),
      channelHealth: this.healthMonitor.toJSON(),
    };
  }

  getHealthMonitor(): ChannelHealthMonitor {
    return this.healthMonitor;
  }
}

export function createChannelManager(config: Config, bus: MessageBus): ChannelManager {
  return new ChannelManager(config, bus);
}
