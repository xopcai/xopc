import { existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { main as piMain } from '@earendil-works/pi-coding-agent';
import { getNativePiAgentDir, prepareNativeMcpConfig } from '../../agent/mcp/native-mcp.js';
import { Command } from 'commander';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { loadConfig } from '../../config/loader.js';
import { createCapabilityMcpServer } from '../../mcp/capability-server.js';
import { createGatewayHttpClientFromConfig } from '../../mcp/gateway-http-client.js';
import { register, type CLIContext } from '../registry.js';

function createMcpCommand(ctx: CLIContext): Command {
  const command = new Command('mcp').description('Manage native pi MCP servers and expose Gateway capabilities');
  for (const action of ['list', 'login', 'logout'] as const) {
    const native = command.command(action).description(`Use pi's native MCP ${action}`);
    if (action !== 'list') native.argument('<server>', 'Configured MCP server ID');
    if (action === 'list') native.option('--json', 'Print pi MCP diagnostics as JSON');
    if (action === 'login') native.option('--timeout <seconds>', 'Browser sign-in timeout in seconds');
    native.action(async (serverOrOptions: string | { json?: boolean }, loginOptions?: { timeout?: string }) => {
      const server = typeof serverOrOptions === 'string' ? serverOrOptions : undefined;
      const options = typeof serverOrOptions === 'string' ? loginOptions : serverOrOptions;
      const config = loadConfig(ctx.configPath);
      const mcp = await prepareNativeMcpConfig(config, ctx.workspacePath || process.cwd());
      if (mcp.errors.length) throw new Error(mcp.errors.join('\n'));
      const path = join(getNativePiAgentDir(), 'mcp.json');
      if (existsSync(path) && JSON.parse(readFileSync(path, 'utf8')).xopcGenerated !== true) {
        throw new Error('The pi directory contains a user-managed mcp.json. Use a dedicated PI_CODING_AGENT_DIR for xopc.');
      }
      // A private generated view for the upstream CLI, never an independent configuration authority.
      if (existsSync(path)) chmodSync(path, 0o600);
      writeFileSync(path, JSON.stringify({ xopcGenerated: true,
        mcpServers: Object.fromEntries(mcp.servers.map(entry => [entry.name, entry.config])),
      }), { mode: 0o600 });
      await piMain(['mcp', action, ...(server ? [server] : []),
        ...(action === 'list' && (options as { json?: boolean })?.json ? ['--json'] : []),
        ...(action === 'login' && loginOptions?.timeout ? ['--timeout', loginOptions.timeout] : []),
      ]);
    });
  }
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

register({ id: 'mcp', name: 'mcp', description: 'Manage native pi MCP servers and expose Gateway capabilities',
  factory: createMcpCommand, metadata: { category: 'utility', examples: ['xopc mcp capabilities --allow-capability xopc.notes.list'] } });
