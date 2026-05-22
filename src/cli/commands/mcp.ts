import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { parseConfigValue } from '../../chat-commands/config-value.js';
import {
  listConfiguredMcpServers,
  setConfiguredMcpServer,
  unsetConfiguredMcpServer,
} from '../../config/mcp-config.js';
import { serveXopcChannelMcpImpl } from '../../mcp/channel-server.js';
import { register, formatExamples, type CLIContext } from '../registry.js';

function readOptionalFile(path: string | undefined): string | undefined {
  if (!path?.trim()) {
    return undefined;
  }
  return readFileSync(path.trim(), 'utf-8').trim();
}

function createMcpCommand(ctx: CLIContext): Command {
  const cmd = new Command('mcp')
    .description('Manage xopc MCP config and channel bridge')
    .addHelpText(
      'after',
      formatExamples([
        'xopc mcp list',
        'xopc mcp set github \'{"command":"npx","args":["-y","@modelcontextprotocol/server-github"]}\'',
        'xopc mcp serve --url http://127.0.0.1:18790',
      ]),
    );

  cmd
    .command('serve')
    .description('Expose xopc channels over MCP stdio')
    .option('--url <url>', 'Gateway HTTP base URL')
    .option('--token <token>', 'Gateway bearer token')
    .option('--token-file <path>', 'Read gateway token from file')
    .option('--claude-channel-mode <mode>', 'Claude channel mode: auto, on, or off', 'auto')
    .option('-v, --verbose', 'Verbose logging to stderr', false)
    .action(async (opts) => {
      const mode = String(opts.claudeChannelMode ?? 'auto').toLowerCase();
      if (mode !== 'auto' && mode !== 'on' && mode !== 'off') {
        throw new Error('Invalid --claude-channel-mode. Use auto, on, or off.');
      }
      await serveXopcChannelMcpImpl({
        gatewayUrl: opts.url as string | undefined,
        gatewayToken: (opts.token as string | undefined) ?? readOptionalFile(opts.tokenFile),
        claudeChannelMode: mode as 'auto' | 'on' | 'off',
        verbose: Boolean(opts.verbose),
      });
    });

  cmd
    .command('list')
    .description('List configured MCP servers')
    .option('--json', 'Print JSON')
    .action((opts: { json?: boolean }) => {
      const loaded = listConfiguredMcpServers(ctx.configPath);
      if (!loaded.ok) {
        throw new Error('error' in loaded ? loaded.error : 'Failed to load MCP config');
      }
      if (opts.json) {
        console.log(JSON.stringify(loaded.mcpServers, null, 2));
        return;
      }
      const names = Object.keys(loaded.mcpServers).sort();
      if (names.length === 0) {
        console.log(`No MCP servers configured in ${loaded.path}.`);
        return;
      }
      console.log(`MCP servers (${loaded.path}):`);
      for (const name of names) {
        console.log(`- ${name}`);
      }
    });

  cmd
    .command('show')
    .description('Show one MCP server or all servers')
    .argument('[name]', 'MCP server name')
    .option('--json', 'Print JSON')
    .action((name: string | undefined, opts: { json?: boolean }) => {
      const loaded = listConfiguredMcpServers(ctx.configPath);
      if (!loaded.ok) {
        throw new Error('error' in loaded ? loaded.error : 'Failed to load MCP config');
      }
      const value = name ? loaded.mcpServers[name] : loaded.mcpServers;
      if (name && !value) {
        throw new Error(`No MCP server named "${name}" in ${loaded.path}.`);
      }
      console.log(JSON.stringify(value ?? {}, null, 2));
      if (!opts.json && !name) {
        console.log(`(${loaded.path})`);
      }
    });

  cmd
    .command('set')
    .description('Upsert an MCP server definition')
    .argument('<name>', 'Server name')
    .argument('<json>', 'Server config JSON')
    .action(async (name: string, json: string) => {
      const parsed = parseConfigValue(json);
      if (!parsed.ok) {
        throw new Error('error' in parsed ? parsed.error : 'Invalid JSON');
      }
      const result = await setConfiguredMcpServer({
        name,
        server: parsed.value,
        configPath: ctx.configPath,
      });
      if (!result.ok) {
        throw new Error('error' in result ? result.error : 'Failed to save MCP server');
      }
      console.log(`Saved MCP server "${name}" to ${result.path}.`);
    });

  cmd
    .command('unset')
    .description('Remove an MCP server definition')
    .argument('<name>', 'Server name')
    .action(async (name: string) => {
      const result = await unsetConfiguredMcpServer({ name, configPath: ctx.configPath });
      if (!result.ok) {
        throw new Error('error' in result ? result.error : 'Failed to unset MCP server');
      }
      console.log(
        result.removed
          ? `Removed MCP server "${name}" from ${result.path}.`
          : `No MCP server named "${name}" in ${result.path}.`,
      );
    });

  return cmd;
}

register({
  id: 'mcp',
  name: 'mcp',
  description: 'MCP server registry and channel bridge',
  factory: createMcpCommand,
  metadata: {
    category: 'setup',
    examples: [
      'xopc mcp list',
      'xopc mcp serve',
    ],
  },
});

export { createMcpCommand };
