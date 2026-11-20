import { existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { main as piMain } from '@earendil-works/pi-coding-agent';
import { resolveMcpSetupConfig } from '../../agent/mcp/effective-server.js';
import { getNativePiAgentDir, prepareNativeMcpConfig } from '../../agent/mcp/native-mcp.js';
import { Command } from 'commander';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { loadConfig } from '../../config/loader.js';
import { createCapabilityMcpServer } from '../../mcp/capability-server.js';
import { GatewayHttpClient } from '../../mcp/gateway-http-client.js';
import { createMcpConnection, revokeMcpConnection } from '../../mcp/connection-grants.js';
import { isMcpProductTool, listMcpProductTools } from '../../mcp/product-tools.js';
import { createGatewayCredential } from '../../gateway/credential.js';
import { resolveEffectiveGatewayPort } from '../../gateway/host.js';
import { grantRemoteMcpConnection, listRemoteMcpGrants, revokeRemoteMcpConnection } from '../../mcp/remote-grants.js';
import { register, type CLIContext } from '../registry.js';

function createMcpCommand(ctx: CLIContext, getCtx = () => ctx): Command {
  const command = new Command('mcp').description('Manage native pi MCP servers and expose Gateway capabilities');
  for (const action of ['list', 'login', 'logout'] as const) {
    const native = command.command(action).description(`Use pi's native MCP ${action}`);
    if (action !== 'list') native.argument('<server>', 'Configured MCP server ID');
    if (action === 'list') native.option('--json', 'Print pi MCP diagnostics as JSON').option('--agent <id>', 'Include plugins bound to this agent');
    if (action === 'login') native.option('--timeout <seconds>', 'Browser sign-in timeout in seconds');
    native.action(async (serverOrOptions: string | { json?: boolean; agent?: string }, loginOptions?: { timeout?: string }) => {
      const server = typeof serverOrOptions === 'string' ? serverOrOptions : undefined;
      const options = typeof serverOrOptions === 'string' ? loginOptions : serverOrOptions;
      const config = loadConfig(ctx.configPath);
      const mcp = await prepareNativeMcpConfig(server ? resolveMcpSetupConfig(config, server) : config, ctx.workspacePath || process.cwd(), (options as { agent?: string })?.agent);
      if (mcp.errors.length) throw new Error(mcp.errors.join('\n'));
      const path = join(await getNativePiAgentDir(), 'mcp.json');
      if (existsSync(path) && JSON.parse(readFileSync(path, 'utf8')).xopcGenerated !== true) {
        throw new Error('The pi directory contains a user-managed mcp.json. Use a dedicated PI_CODING_AGENT_DIR for xopc.');
      }
      // A private generated view for the upstream CLI, never an independent configuration authority.
      if (existsSync(path)) chmodSync(path, 0o600);
      writeFileSync(path, JSON.stringify({ xopcGenerated: true,
        mcpServers: Object.fromEntries(mcp.servers.filter(entry => !server || entry.name === server).map(entry => [mcp.credentialAliases?.[entry.name] ?? entry.name, entry.config])),
      }), { mode: 0o600 });
      await piMain(['mcp', action, ...(server ? [mcp.credentialAliases?.[server] ?? server] : []),
        ...(action === 'list' && (options as { json?: boolean })?.json ? ['--json'] : []),
        ...(action === 'login' && loginOptions?.timeout ? ['--timeout', loginOptions.timeout] : []),
      ]);
    });
  }
  command.command('grant')
    .description('Create a local MCP connection grant for the entire personal workspace')
    .option('--write', 'Include all published write tools alongside read tools')
    .option('--allow-capability <ids...>', 'Grant only these exact capability IDs')
    .action((options: { write?: boolean; allowCapability?: string[] }) => {
      if (options.write && options.allowCapability) throw new Error('Choose --write or --allow-capability');
      const ids = options.allowCapability ?? listMcpProductTools(Boolean(options.write));
      if (ids.some(id => !isMcpProductTool(id))) throw new Error('Unknown MCP capability ID');
      console.log(JSON.stringify(createMcpConnection(ids)));
    });
  command.command('revoke')
    .description('Revoke a local MCP connection grant')
    .argument('<connection-id>')
    .action(revokeMcpConnection);
  const remote = command.command('remote').description('Manage OAuth grants for the remote MCP server');
  remote.command('grant')
    .requiredOption('--subject <subject>', 'Subject claim for the approved user at the configured OAuth issuer')
    .requiredOption('--client-id <id>', 'Registered OAuth client ID')
    .option('--write', 'Grant read/write access to the personal workspace')
    .option('--allow-capability <ids...>', 'Grant only these exact capability IDs')
    .action((options: { subject: string; clientId: string; write?: boolean; allowCapability?: string[] }) => {
      const config = loadConfig(getCtx().configPath).gateway?.mcp;
      if (!config) throw new Error('Configure gateway.mcp before granting access');
      const { resource, issuer } = config;
      const grant = grantRemoteMcpConnection({ resource, issuer, subject: options.subject, clientId: options.clientId }, {
        capabilityIds: options.allowCapability, write: options.write,
      });
      console.log(JSON.stringify(grant));
    });
  remote.command('list').action(() => console.log(JSON.stringify(listRemoteMcpGrants())));
  remote.command('revoke').argument('<connection-id>').action((connectionId: string) => {
    if (!revokeRemoteMcpConnection(connectionId)) throw new Error('Active remote MCP connection not found');
  });
  command.command('serve')
    .description('Run the Gateway MCP server on stdio')
    .requiredOption('--stdio', 'Use the stdio transport')
    .option('--port <number>', 'Loopback Gateway port (defaults to gateway.port)')
    .action(async (options: { port?: string }) => {
      const credential = createGatewayCredential('token', process.env.XOPC_MCP_TOKEN);
      if (!credential) throw new Error('Set XOPC_MCP_TOKEN to a token from xopc mcp grant');
      const port = options.port === undefined ? resolveEffectiveGatewayPort(loadConfig(ctx.configPath)) : Number(options.port);
      if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error('Expected a Gateway port between 1 and 65535');
      const client = new GatewayHttpClient({ baseUrl: `http://127.0.0.1:${port}`, credential });
      const server = createCapabilityMcpServer(client);
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
  factory: createMcpCommand, metadata: { category: 'utility', examples: ['xopc mcp serve --stdio'] } });
