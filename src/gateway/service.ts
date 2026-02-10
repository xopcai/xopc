import { AgentService } from '../agent/index.js';
import { ChannelManager } from '../channels/manager.js';
import { MessageBus } from '../bus/index.js';
import { loadConfig } from '../config/index.js';
import { createLogger } from '../utils/logger.js';
import type { Config } from '../config/schema.js';

const log = createLogger('GatewayService');

export interface GatewayServiceConfig {
  configPath?: string;
}

export class GatewayService {
  private bus: MessageBus;
  private config: Config;
  private agentService: AgentService;
  private channelManager: ChannelManager;
  private running = false;

  constructor(private serviceConfig: GatewayServiceConfig = {}) {
    this.bus = new MessageBus();
    this.config = loadConfig(serviceConfig.configPath);

    // Initialize channel manager
    this.channelManager = new ChannelManager(this.config, this.bus);

    // Initialize agent service
    this.agentService = new AgentService(this.bus, {
      workspace: this.config.agents?.defaults?.workspace || './workspace',
      model: this.config.agents?.defaults?.model,
      braveApiKey: this.config.tools?.web?.search?.apiKey,
      config: this.config,
    });
  }

  async start(): Promise<void> {
    if (this.running) return;

    log.info('Starting gateway service...');

    // Start channels
    await this.channelManager.startAll();

    // Start agent service (runs in background)
    this.agentService.start().catch((err) => {
      log.error({ err }, 'Agent service error');
    });

    this.running = true;
    log.info('Gateway service started');
  }

  async stop(): Promise<void> {
    if (!this.running) return;

    log.info('Stopping gateway service...');

    this.agentService.stop();
    await this.channelManager.stopAll();

    this.running = false;
    log.info('Gateway service stopped');
  }

  /**
   * Run agent with a message and stream events
   */
  async *runAgent(
    message: string,
    channel: string,
    chatId: string
  ): AsyncGenerator<{ type: string; content?: string; status?: string; runId?: string }, { status: string; summary: string }, unknown> {
    const runId = crypto.randomUUID();

    yield { type: 'status', status: 'accepted', runId };

    try {
      // Send message through bus
      await this.bus.publishInbound({
        channel,
        sender_id: 'gateway',
        chat_id: chatId,
        content: message,
      });

      // Wait for and collect response
      // This is simplified - in production we'd need proper session tracking
      yield { type: 'token', content: 'Processing...\\n' };

      // Simulate processing delay
      await new Promise((resolve) => setTimeout(resolve, 1000));

      yield { type: 'token', content: 'Done\\n' };

      return { status: 'ok', summary: 'Message processed' };
    } catch (error) {
      log.error({ err: error }, 'Agent run failed');
      throw error;
    }
  }

  /**
   * Send message through a channel
   */
  async sendMessage(
    channel: string,
    chatId: string,
    content: string
  ): Promise<{ sent: boolean; messageId?: string }> {
    try {
      await this.channelManager.send({
        channel,
        chat_id: chatId,
        content,
      });
      return { sent: true, messageId: `msg_${Date.now()}` };
    } catch (error) {
      log.error({ err: error, channel, chatId }, 'Failed to send message');
      throw error;
    }
  }

  /**
   * Get channel statuses
   */
  getChannelsStatus(): Array<{
    name: string;
    enabled: boolean;
    connected: boolean;
  }> {
    const allChannels = this.channelManager.getAllChannels();
    const runningChannels = new Set(this.channelManager.getRunningChannels());

    // Check which channels are configured
    const configChannels = [
      { name: 'telegram', enabled: !!this.config.channels?.telegram?.enabled },
      { name: 'whatsapp', enabled: !!this.config.channels?.whatsapp?.enabled },
    ];

    return configChannels.map((ch) => ({
      ...ch,
      connected: runningChannels.has(ch.name),
    }));
  }

  /**
   * Get health status
   */
  getHealth(): {
    status: string;
    service: string;
    version: string;
    uptime: number;
    channels: { running: number; total: number };
  } {
    const runningChannels = this.channelManager.getRunningChannels();
    const allChannels = this.channelManager.getAllChannels();

    return {
      status: 'ok',
      service: 'xopcbot-gateway',
      version: '0.1.0',
      uptime: process.uptime(),
      channels: {
        running: runningChannels.length,
        total: allChannels.length,
      },
    };
  }

  get isRunning(): boolean {
    return this.running;
  }
}
