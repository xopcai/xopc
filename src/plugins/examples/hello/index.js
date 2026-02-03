/**
 * Hello World Plugin Example
 * 
 * Demonstrates basic plugin functionality:
 * - Tool registration
 * - Hook registration
 * - Command registration
 * - Configuration usage
 */

import type { PluginApi } from '../../../types.js';

// Plugin definition
const plugin = {
  id: 'hello',
  name: 'Hello World',
  description: 'A simple example plugin',
  version: '1.0.0',

  // Register is called when the plugin is loaded
  register(api: PluginApi) {
    // Log that the plugin is registered
    api.logger.info('Hello World plugin registered!');
    
    // Log plugin configuration
    const greeting = (api.pluginConfig.greeting as string) || 'Hello';
    const verbose = api.pluginConfig.verbose as boolean;
    
    api.logger.info(`Greeting: ${greeting}`);
    api.logger.info(`Verbose: ${verbose}`);

    // Register a custom tool
    api.registerTool({
      name: 'hello',
      description: 'Say hello to someone',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Name to greet',
          },
          times: {
            type: 'number',
            description: 'Number of times to greet (1-10)',
            default: 1,
          },
        },
        required: ['name'],
      },
      async execute(params) {
        const name = params.name as string;
        const times = Math.min(Math.max((params.times as number) || 1, 1), 10);
        const greeting = (api.pluginConfig.greeting as string) || 'Hello';
        
        const greetings = [];
        for (let i = 0; i < times; i++) {
          greetings.push(`${greeting}, ${name}!`);
        }
        
        api.logger.info(`Greeted ${name} ${times} time(s)`);
        return greetings.join('\n');
      },
    });

    // Register a command
    api.registerCommand({
      name: 'hello',
      description: 'Send a greeting',
      acceptsArgs: true,
      requireAuth: false,
      handler: async (args, context) => {
        const name = args || 'World';
        const greeting = (api.pluginConfig.greeting as string) || 'Hello';
        return {
          content: `${greeting}, ${name}!`,
          success: true,
        };
      },
    });

    // Register hooks
    api.registerHook('before_tool_call', async (event, ctx) => {
      const toolCall = event as { toolName: string; params: Record<string, unknown> };
      api.logger.info(`Tool called: ${toolCall.toolName}`);
    });

    api.registerHook('after_tool_call', async (event, ctx) => {
      const toolCall = event as { toolName: string; durationMs?: number };
      api.logger.info(`Tool completed: ${toolCall.toolName} (${toolCall.durationMs || 0}ms)`);
    });

    // Register a simple HTTP route
    api.registerHttpRoute('/hello', async (req, res) => {
      const greeting = (api.pluginConfig.greeting as string) || 'Hello';
      res.json({ message: greeting, plugin: 'hello' });
    });

    // Register a gateway method
    api.registerGatewayMethod('hello', async (params) => {
      const name = (params.name as string) || 'World';
      const greeting = (api.pluginConfig.greeting as string) || 'Hello';
      return { message: `${greeting}, ${name}!` };
    });

    api.logger.info('Hello World plugin fully initialized');
  },

  // Activate is called when the plugin is enabled
  activate(api: PluginApi) {
    api.logger.info('Hello World plugin activated!');
  },

  // Deactivate is called when the plugin is disabled
  deactivate(api: PluginApi) {
    api.logger.info('Hello World plugin deactivated');
  },
};

export default plugin;
