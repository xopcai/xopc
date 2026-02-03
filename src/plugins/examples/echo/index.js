/**
 * Echo Plugin Example
 * 
 * Demonstrates message modification hooks and message processing.
 */

import type { PluginApi } from '../../../types.js';

const plugin = {
  id: 'echo',
  name: 'Echo Plugin',
  description: 'Echoes messages back with modifications',
  version: '1.0.0',

  register(api: PluginApi) {
    api.logger.info('Echo plugin registered');

    // Register the echo tool
    api.registerTool({
      name: 'echo',
      description: 'Echo a message with optional modifications',
      parameters: {
        type: 'object',
        properties: {
          message: {
            type: 'string',
            description: 'Message to echo',
          },
          prefix: {
            type: 'string',
            description: 'Prefix to add (overrides config)',
          },
          uppercase: {
            type: 'boolean',
            description: 'Convert to uppercase',
          },
          reverse: {
            type: 'boolean',
            description: 'Reverse the message',
          },
        },
        required: ['message'],
      },
      async execute(params) {
        let message = params.message as string;
        const prefix = (params.prefix || api.pluginConfig.prefix) as string;
        const uppercase = params.uppercase ?? api.pluginConfig.uppercase;
        const reverse = params.reverse ?? api.pluginConfig.reverse;

        if (uppercase) {
          message = message.toUpperCase();
        }

        if (reverse) {
          message = message.split('').reverse().join('');
        }

        if (prefix) {
          message = `${prefix} ${message}`;
        }

        return message;
      },
    });

    // Modify outgoing messages
    api.registerHook('message_sending', async (event, ctx) => {
      const messageEvent = event as {
        to: string;
        content: string;
        metadata?: Record<string, unknown>;
      };
      
      const prefix = (api.pluginConfig.prefix as string) || '';
      if (prefix && messageEvent.content) {
        messageEvent.content = `${prefix} ${messageEvent.content}`;
      }

      return { content: messageEvent.content };
    });

    // Log received messages
    api.registerHook('message_received', async (event, ctx) => {
      const receivedEvent = event as {
        from: string;
        content: string;
        channelId?: string;
      };
      
      api.logger.info(`Message from ${receivedEvent.from}: ${receivedEvent.content.substring(0, 100)}`);
    });

    api.logger.info('Echo plugin fully initialized');
  },

  activate(api: PluginApi) {
    api.logger.info('Echo plugin activated');
  },

  deactivate(api: PluginApi) {
    api.logger.info('Echo plugin deactivated');
  },
};

export default plugin;
