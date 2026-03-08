/**
 * Xopcbot Feishu Plugin
 *
 * Feishu/Lark (飞书) channel plugin for xopcbot.
 *
 * Features:
 * - WebSocket-based event receiving
 * - Send/receive text, image, and file messages
 * - Session routing (DM and group chats)
 * - Allowlist/policy management
 * - Media download and processing
 *
 * Installation:
 *   xopcbot plugin install ./examples/plugins/xopcbot-feishu
 *
 * Configuration (config.json):
 *   {
 *     "plugins": {
 *       "enabled": ["xopcbot-feishu"],
 *       "xopcbot-feishu": {
 *         "enabled": true,
 *         "appId": "cli_xxxxxxxx",
 *         "appSecret": "your-secret",
 *         "domain": "feishu",
 *         "dmPolicy": "pairing",
 *         "groupPolicy": "allowlist",
 *         "requireMention": true
 *       }
 *     }
 *   }
 *
 * Required Feishu Permissions:
 *   - im:message:send_as_bot (发送消息)
 *   - im:message.p2p_msg:readonly (接收私聊)
 *   - im:message.group_at_msg:readonly (接收群@消息)
 *   - im:resource (媒体资源)
 */

import type { PluginApi, PluginDefinition } from 'xopcbot/plugin-sdk';
import { FeishuChannel } from './src/channel.js';
import type { FeishuConfig } from './src/types.js';

// Global channel instance
let feishuChannel: FeishuChannel | null = null;

/**
 * Get Feishu configuration from plugin config
 */
function getFeishuConfig(api: PluginApi): FeishuConfig {
  const config = api.pluginConfig as Record<string, unknown>;

  return {
    enabled: config.enabled === true,
    appId: (config.appId as string) || '',
    appSecret: (config.appSecret as string) || '',
    domain: (config.domain as 'feishu' | 'lark') || 'feishu',
    dmPolicy: (config.dmPolicy as 'open' | 'pairing' | 'allowlist') || 'pairing',
    groupPolicy: (config.groupPolicy as 'open' | 'allowlist' | 'disabled') || 'allowlist',
    allowFrom: (config.allowFrom as string[]) || [],
    groupAllowFrom: (config.groupAllowFrom as string[]) || [],
    requireMention: config.requireMention !== false,
    mediaMaxMb: (config.mediaMaxMb as number) || 30,
  };
}

/**
 * Validate configuration
 */
function validateConfig(config: FeishuConfig): { valid: boolean; error?: string } {
  if (!config.enabled) {
    return { valid: true };
  }

  if (!config.appId) {
    return { valid: false, error: 'Feishu appId is required' };
  }

  if (!config.appSecret) {
    return { valid: false, error: 'Feishu appSecret is required' };
  }

  if (!config.appId.startsWith('cli_')) {
    return { valid: false, error: 'Feishu appId should start with "cli_"' };
  }

  return { valid: true };
}

const plugin: PluginDefinition = {
  id: 'xopcbot-feishu',
  name: 'Xopcbot Feishu',
  description: 'Feishu/Lark channel plugin for xopcbot with WebSocket support',
  version: '1.0.0',
  kind: 'channel',

  register(api: PluginApi) {
    api.logger.info('Feishu plugin registering...');

    const feishuConfig = getFeishuConfig(api);
    const validation = validateConfig(feishuConfig);

    if (!validation.valid) {
      api.logger.error(`Feishu config error: ${validation.error}`);
      return;
    }

    if (!feishuConfig.enabled) {
      api.logger.info('Feishu plugin is disabled');
      return;
    }

    // Get default agent ID from config
    const defaultAgentId = (api.config.defaultAgent as string) || 'default';

    // Create channel instance
    feishuChannel = new FeishuChannel({
      config: feishuConfig,
      api,
      defaultAgentId,
    });

    // Register channel
    api.registerChannel(feishuChannel);

    // Register send command
    api.registerCommand({
      name: 'feishu',
      description: 'Send a message via Feishu channel',
      acceptsArgs: true,
      requireAuth: true,
      handler: async (args, context) => {
        if (!args) {
          return {
            content: 'Usage: /feishu <chat_id> <message>',
            success: false,
          };
        }

        const parts = args.split(' ');
        if (parts.length < 2) {
          return {
            content: 'Usage: /feishu <chat_id> <message>',
            success: false,
          };
        }

        const chatId = parts[0];
        const message = parts.slice(1).join(' ');

        try {
          await feishuChannel?.send({
            channel: 'feishu',
            chat_id: chatId,
            content: message,
          });

          return {
            content: `Message sent to ${chatId}`,
            success: true,
          };
        } catch (error) {
          return {
            content: `Failed to send: ${error}`,
            success: false,
          };
        }
      },
    });

    // Register feishu-send tool for agents
    api.registerTool({
      name: 'feishu_send',
      description: 'Send a message via Feishu to a specific chat or user',
      parameters: {
        type: 'object',
        properties: {
          to: {
            type: 'string',
            description: 'Chat ID (chat_xxx) or user OpenID',
          },
          message: {
            type: 'string',
            description: 'Message content to send',
          },
        },
        required: ['to', 'message'],
      },
      async execute(params) {
        const to = params.to as string;
        const message = params.message as string;

        if (!feishuChannel?.isRunning()) {
          return 'Error: Feishu channel is not running';
        }

        try {
          await feishuChannel.send({
            channel: 'feishu',
            chat_id: to,
            content: message,
          });

          return `Message sent to ${to}`;
        } catch (error) {
          return `Failed to send message: ${error}`;
        }
      },
    });

    // Handle message_sending hook
    api.registerHook('message_sending', async (event) => {
      const msgEvent = event as {
        channel?: string;
        to?: string;
        content?: string;
      };

      if (msgEvent.channel === 'feishu' && feishuChannel?.isRunning()) {
        api.logger.debug(`Sending Feishu message to ${msgEvent.to}`);
      }

      return event;
    });

    api.logger.info('Feishu plugin registered successfully');
  },

  async activate(api: PluginApi) {
    api.logger.info('Feishu plugin activating...');

    if (feishuChannel) {
      try {
        await feishuChannel.start();
        api.logger.info('Feishu channel started');
      } catch (error) {
        api.logger.error(`Failed to start Feishu channel: ${error}`);
      }
    }
  },

  async deactivate(api: PluginApi) {
    api.logger.info('Feishu plugin deactivating...');

    if (feishuChannel) {
      await feishuChannel.stop();
      feishuChannel = null;
    }

    api.logger.info('Feishu plugin deactivated');
  },
};

export default plugin;

// Re-exports for advanced usage
export { FeishuChannel } from './src/channel.js';
export * from './src/types.js';
export * from './src/client.js';
export * from './src/send.js';
export * from './src/media.js';
