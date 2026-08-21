import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { Config } from '../config/schema.js';
import { loadConfig } from '../config/loader.js';
import type { GatewayCredential } from '../gateway/credential.js';
import { PACKAGE_VERSION } from '../package-version.js';
import { XopcChannelBridge } from './channel-bridge.js';
import { ClaudePermissionRequestSchema, type ClaudeChannelMode } from './channel-shared.js';
import { getChannelMcpCapabilities, registerChannelMcpTools } from './channel-tools.js';

export type XopcMcpServeOptions = {
  gatewayUrl?: string;
  gatewayCredential?: GatewayCredential;
  config?: Config;
  claudeChannelMode?: ClaudeChannelMode;
  verbose?: boolean;
};

export async function createXopcChannelMcpServer(opts: XopcMcpServeOptions = {}): Promise<{
  server: McpServer;
  bridge: XopcChannelBridge;
  start: () => Promise<void>;
  close: () => Promise<void>;
}> {
  const cfg = opts.config ?? loadConfig();
  const claudeChannelMode = opts.claudeChannelMode ?? 'auto';
  const capabilities = getChannelMcpCapabilities(claudeChannelMode);
  const server = new McpServer({ name: 'xopc', version: PACKAGE_VERSION }, capabilities ? { capabilities } : undefined);
  const bridge = new XopcChannelBridge(cfg, {
    gatewayUrl: opts.gatewayUrl,
    gatewayCredential: opts.gatewayCredential,
  });

  server.server.setNotificationHandler(ClaudePermissionRequestSchema, async ({ params }) => {
    await bridge.handleClaudePermissionRequest({
      requestId: params.request_id,
      toolName: params.tool_name,
      description: params.description,
      inputPreview: params.input_preview,
    });
  });
  registerChannelMcpTools(server, bridge);

  return {
    server,
    bridge,
    start: async () => {
      await bridge.start();
    },
    close: async () => {
      await bridge.close();
      await server.close();
    },
  };
}

export async function serveXopcChannelMcpImpl(opts: XopcMcpServeOptions = {}): Promise<void> {
  const { server, start, close } = await createXopcChannelMcpServer(opts);
  const transport = new StdioServerTransport();

  let shuttingDown = false;
  let resolveClosed!: () => void;
  const closed = new Promise<void>((resolve) => {
    resolveClosed = resolve;
  });

  const shutdown = () => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    process.stdin.off('end', shutdown);
    process.stdin.off('close', shutdown);
    process.off('SIGINT', shutdown);
    process.off('SIGTERM', shutdown);
    transport['onclose'] = undefined;
    close().then(resolveClosed, resolveClosed);
  };

  transport['onclose'] = shutdown;
  process.stdin.once('end', shutdown);
  process.stdin.once('close', shutdown);
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  try {
    await server.connect(transport);
    await start();
    await closed;
  } finally {
    shutdown();
    await closed;
  }
}
