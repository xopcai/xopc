/**
 * Hello World Extension Example
 * 
 * Demonstrates basic extension functionality:
 * - Tool registration
 * - Hook registration
 * - Command registration
 * - Configuration usage
 * 
 * Installation:
 *   xopcbot extension install ./examples/extensions/hello
 * 
 * Or copy to your workspace:
 *   cp -r examples/extensions/hello workspace/.extensions/
 */

import type { ExtensionApi } from 'xopcbot/extension-sdk';

// Extension definition
const extension = {
  id: 'hello',
  name: 'Hello World',
  description: 'A simple example extension',
  version: '1.0.0',

  // Register is called when the extension is loaded
  register(api: ExtensionApi) {
    // Log that the extension is registered
    api.logger.info('Hello World extension registered!');
    
    // Log extension configuration
    const greeting = (api.extensionConfig.greeting as string) || 'Hello';
    const verbose = api.extensionConfig.verbose as boolean;
    
    api.logger.info(`Greeting: ${greeting}`);
    if (verbose) {
      api.logger.info(`Verbose mode enabled`);
    }

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
        const greeting = (api.extensionConfig.greeting as string) || 'Hello';
        
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
      handler: async (args, _context) => {
        const name = args || 'World';
        const greeting = (api.extensionConfig.greeting as string) || 'Hello';
        return {
          content: `${greeting}, ${name}!`,
          success: true,
        };
      },
    });

    // Register hooks
    api.registerHook('before_tool_call', async (event, _ctx) => {
      const toolCall = event as { toolName: string; params: Record<string, unknown> };
      api.logger.info(`Tool called: ${toolCall.toolName}`);
    });

    api.registerHook('after_tool_call', async (event, _ctx) => {
      const toolCall = event as { toolName: string; durationMs?: number };
      api.logger.info(`Tool completed: ${toolCall.toolName} (${toolCall.durationMs || 0}ms)`);
    });

    // Register a simple HTTP route
    api.registerHttpRoute('/hello', async (_req, res) => {
      const greeting = (api.extensionConfig.greeting as string) || 'Hello';
      res.json({ message: greeting, extension: 'hello' });
    });

    // Register a gateway method
    api.registerGatewayMethod('hello', async (params) => {
      const name = (params.name as string) || 'World';
      const greeting = (api.extensionConfig.greeting as string) || 'Hello';
      return { message: `${greeting}, ${name}!` };
    });

    api.logger.info('Hello World extension fully initialized');
  },

  // Activate is called when the extension is enabled
  activate(api: ExtensionApi) {
    api.logger.info('Hello World extension activated!');
  },

  // Deactivate is called when the extension is disabled
  deactivate(api: ExtensionApi) {
    api.logger.info('Hello World extension deactivated');
  },
};

export default extension;
