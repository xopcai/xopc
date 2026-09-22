import { Command } from 'commander';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { loadConfig } from '../../config/loader.js';
import { createCapabilityMcpServer } from '../../mcp/capability-server.js';
import { createGatewayHttpClientFromConfig } from '../../mcp/gateway-http-client.js';
import { register, type CLIContext } from '../registry.js';

function createMcpCommand(ctx: CLIContext): Command {
  const command = new Command('mcp').description('Expose selected Gateway capabilities over MCP');
  command.command('capabilities')
    .description('Run an opt-in stdio MCP proxy for an explicit capability allowlist')
    .requiredOption('--allow-capability <ids...>', 'Exact capability IDs; no wildcards')
    .action(async (options: { allowCapability: string[] }) => {
      const client = createGatewayHttpClientFromConfig({ config: loadConfig(ctx.configPath) });
      const server = createCapabilityMcpServer(client, options.allowCapability);
      const transport = new StdioServerTransport();
      let resolveClosed!: () => void;
      const closed = new Promise<void>(resolve => { resolveClosed = resolve; });
      let closing = false;
      const shutdown = () => {
        if (closing) return;
        closing = true;
        void server.close().then(resolveClosed, resolveClosed);
      };
      server.onclose = resolveClosed;
      process.once('SIGINT', shutdown);
      process.once('SIGTERM', shutdown);
      process.stdin.once('end', shutdown);
      try {
        await server.connect(transport);
        await closed;
      } finally {
        process.off('SIGINT', shutdown);
        process.off('SIGTERM', shutdown);
        process.stdin.off('end', shutdown);
        await server.close();
      }
    });
  return command;
}

register({ id: 'mcp', name: 'mcp', description: 'Expose selected Gateway capabilities over MCP',
  factory: createMcpCommand, metadata: { category: 'utility', examples: ['xopc mcp capabilities --allow-capability xopc.notes.list'] } });
