import { existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { resolveMcpSetupConfig } from '../../agent/mcp/effective-server.js';
import { getNativePiAgentDir, prepareNativeMcpConfig } from '../../agent/mcp/native-mcp.js';
import { registerPiOAuthPageHook } from '../../auth/oauth/pi-oauth-page-hook.js';
import { Command } from 'commander';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { loadConfig } from '../../config/loader.js';
import { createCapabilityMcpServer } from '../../mcp/capability-server.js';
import { GatewayHttpClient } from '../../mcp/gateway-http-client.js';
import { createMcpConnection, listMcpConnections, revokeMcpConnection } from '../../mcp/connection-grants.js';
import {
  isMcpProductTool, listMcpProductTools, MCP_TOOLSETS, resolveMcpToolsetCapabilities,
} from '../../mcp/product-tools.js';
import { createGatewayCredential } from '../../gateway/credential.js';
import { resolveEffectiveGatewayPort } from '../../gateway/host.js';
import { resolveRemoteMcpIssuer } from '../../mcp/remote-config.js';
import { grantRemoteMcpConnection, listRemoteMcpGrants, revokeRemoteMcpConnection } from '../../mcp/remote-grants.js';
import { register, type CLIContext } from '../registry.js';

function parseExpiresInDays(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const days = Number(raw);
  if (!Number.isInteger(days) || days < 1 || days > 3650) {
    throw new Error('--expires-in must be an integer number of days between 1 and 3650');
  }
  return Date.now() + days * 86_400_000;
}

function parseMaxConcurrentRuns(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const max = Number(raw);
  if (!Number.isInteger(max) || max < 1 || max > 50) {
    throw new Error('--max-concurrent-runs must be an integer between 1 and 50');
  }
  return max;
}

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
      writeFileSync(path, JSON.stringify({
        xopcGenerated: true,
        mcpServers: Object.fromEntries(mcp.servers.filter(entry => !server || entry.name === server).map(entry => [mcp.credentialAliases?.[entry.name] ?? entry.name, entry.config])),
      }), { mode: 0o600 });
      registerPiOAuthPageHook();
      const { main: piMain } = await import('@earendil-works/pi-coding-agent');
      await piMain(['mcp', action, ...(server ? [mcp.credentialAliases?.[server] ?? server] : []),
        ...(action === 'list' && (options as { json?: boolean })?.json ? ['--json'] : []),
        ...(action === 'login' && loginOptions?.timeout ? ['--timeout', loginOptions.timeout] : []),
      ]);
    });
  }

  command.command('toolsets')
    .description('List available Gateway MCP capability toolsets (profiles)')
    .action(() => {
      console.log(JSON.stringify([
        ...MCP_TOOLSETS,
        { id: 'full-read', label: 'Full Workspace Read-Only', includesWrite: false, capabilityIds: listMcpProductTools(false) },
        { id: 'full-write', label: 'Full Workspace Read & Write', includesWrite: true, capabilityIds: listMcpProductTools(true) },
      ], null, 2));
    });

  command.command('grant')
    .description('Create a local MCP connection grant (workspace-wide or scoped to specific projects/toolsets)')
    .option('--name <label>', 'Human-readable name for this connection (e.g. "Cursor", "Claude Desktop")')
    .option('--toolset <id>', 'Capability profile preset (core-read, memory-read, workspace-write, delegation, automations, full-read, full-write)')
    .option('--write', 'Include all published write tools alongside read tools')
    .option('--allow-capability <ids...>', 'Grant only these exact capability IDs')
    .option('--project <ids...>', 'Restrict access to these specific project IDs')
    .option('--expires-in <days>', 'Automatically expire this grant after N days')
    .option('--max-concurrent-runs <n>', 'Maximum concurrent delegated agent runs (1-50)')
    .action((options: {
      name?: string; toolset?: string; write?: boolean; allowCapability?: string[];
      project?: string[]; expiresIn?: string; maxConcurrentRuns?: string;
    }) => {
      if (options.write && options.allowCapability) throw new Error('Choose --write or --allow-capability');
      if (options.toolset && options.allowCapability) throw new Error('Choose --toolset or --allow-capability');
      let ids: string[];
      if (options.allowCapability) {
        ids = options.allowCapability;
      } else if (options.toolset) {
        const resolved = resolveMcpToolsetCapabilities(options.toolset, options.write ? true : undefined);
        if (!resolved) throw new Error(`Unknown MCP toolset: ${options.toolset}`);
        ids = resolved;
      } else {
        ids = listMcpProductTools(Boolean(options.write));
      }
      if (ids.some(id => !isMcpProductTool(id))) throw new Error('Unknown MCP capability ID');
      console.log(JSON.stringify(createMcpConnection(ids, {
        name: options.name,
        toolset: options.toolset,
        projectIds: options.project,
        expiresAt: parseExpiresInDays(options.expiresIn),
        maxConcurrentRuns: parseMaxConcurrentRuns(options.maxConcurrentRuns),
      })));
    });

  command.command('list-grants')
    .description('List local MCP connection grants')
    .action(() => {
      console.log(JSON.stringify(listMcpConnections(), null, 2));
    });

  command.command('revoke')
    .description('Revoke a local MCP connection grant')
    .argument('<connection-id>')
    .action(revokeMcpConnection);

  const remote = command.command('remote').description('Manage OAuth grants for the remote MCP server');
  remote.command('grant')
    .requiredOption('--subject <subject>', 'Subject claim for the approved user at the configured OAuth issuer')
    .requiredOption('--client-id <id>', 'Registered OAuth client ID')
    .option('--name <label>', 'Human-readable label for this remote connection')
    .option('--toolset <id>', 'Capability profile preset')
    .option('--write', 'Grant read/write access to the personal workspace')
    .option('--allow-capability <ids...>', 'Grant only these exact capability IDs')
    .option('--project <ids...>', 'Restrict access to these specific project IDs')
    .option('--expires-in <days>', 'Automatically expire this grant after N days')
    .option('--max-concurrent-runs <n>', 'Maximum concurrent delegated agent runs (1-50)')
    .action((options: {
      subject: string; clientId: string; name?: string; toolset?: string; write?: boolean;
      allowCapability?: string[]; project?: string[]; expiresIn?: string; maxConcurrentRuns?: string;
    }) => {
      const config = loadConfig(getCtx().configPath).gateway?.mcp;
      if (!config) throw new Error('Configure gateway.mcp before granting access');
      const resource = config.resource;
      const issuer = resolveRemoteMcpIssuer(config);
      let capabilityIds = options.allowCapability;
      let includesWrite = Boolean(options.write);
      if (!capabilityIds && options.toolset) {
        const resolved = resolveMcpToolsetCapabilities(options.toolset, options.write ? true : undefined);
        if (!resolved) throw new Error(`Unknown MCP toolset: ${options.toolset}`);
        capabilityIds = resolved;
        const readSet = new Set(listMcpProductTools(false));
        if (resolved.some(id => !readSet.has(id))) includesWrite = true;
      }
      const grant = grantRemoteMcpConnection({ resource, issuer, subject: options.subject, clientId: options.clientId }, {
        capabilityIds,
        write: includesWrite,
        name: options.name,
        toolset: options.toolset,
        projectIds: options.project,
        expiresAt: parseExpiresInDays(options.expiresIn),
        maxConcurrentRuns: parseMaxConcurrentRuns(options.maxConcurrentRuns),
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

register({
  id: 'mcp', name: 'mcp', description: 'Manage native pi MCP servers and expose Gateway capabilities',
  factory: createMcpCommand, metadata: { category: 'utility', examples: ['xopc mcp serve --stdio'] },
});
