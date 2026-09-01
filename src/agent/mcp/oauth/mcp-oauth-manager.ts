import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import type { Config } from '../../../config/schema.js';
import { resolveConnectorSecretReferences } from '../../../connectors/secret-store.js';
import { createLogger } from '../../../utils/logger.js';
import { resolveGlobalSingleton } from '../../../utils/global-singleton.js';
import { redactSensitiveUrlLikeString } from '../../../utils/redact-sensitive-url.js';
import { disposeAllSessionMcpRuntimes } from '../bundle-mcp-runtime.js';
import { resolveMcpTransportConfig } from '../mcp-transport-config.js';
import { resolveMcpTransport, type ResolvedMcpTransport } from '../mcp-transport.js';
import { isMcpAuthorizationError } from './mcp-oauth-errors.js';
import { XopcMcpOAuthClientProvider } from './mcp-oauth-provider.js';
import { McpOAuthSession } from './mcp-oauth-session.js';
import { canonicalMcpServerUrl, McpOAuthStore } from './mcp-oauth-store.js';
import type { McpOAuthSessionSnapshot } from './mcp-oauth-types.js';

const log = createLogger('Mcp:OAuth');
const MCP_OAUTH_MANAGER_KEY = Symbol.for('xopc.mcpOAuthManager');

export type McpOAuthConnectionStatus =
  | 'not_configured'
  | 'disconnected'
  | 'authorizing'
  | 'connected'
  | 'error';

export type McpOAuthStatus = {
  configured: boolean;
  status: McpOAuthConnectionStatus;
  session?: McpOAuthSessionSnapshot;
};

type StartMcpOAuthParams = {
  serverId: string;
  rawServer: unknown;
  cfg?: Config;
};

function createClient(): Client {
  return new Client({ name: 'xopc-mcp-oauth', version: '0.0.0' });
}

async function connectClient(client: Client, resolved: ResolvedMcpTransport): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`MCP server connection timed out after ${resolved.connectionTimeoutMs}ms`)),
      resolved.connectionTimeoutMs,
    );
    client.connect(resolved.transport).then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function closeConnection(client: Client, resolved: ResolvedMcpTransport): Promise<void> {
  await client.close().catch(() => {});
  await resolved.transport.close().catch(() => {});
  resolved.detachStderr?.();
}

function isAuthorizing(snapshot: McpOAuthSessionSnapshot): boolean {
  return ['starting', 'waiting_browser', 'exchanging_code'].includes(snapshot.status);
}

export class McpOAuthManager {
  private readonly store: McpOAuthStore;
  private readonly sessionsByServerUrl = new Map<string, McpOAuthSession>();

  constructor(store = new McpOAuthStore()) {
    this.store = store;
  }

  async status(serverId: string, rawServer: unknown): Promise<McpOAuthStatus> {
    const resolved = resolveMcpTransportConfig(serverId, rawServer);
    if (!resolved || resolved.kind !== 'http' || !resolved.auth) {
      return { configured: false, status: 'not_configured' };
    }
    const session = this.sessionsByServerUrl.get(canonicalMcpServerUrl(resolved.url))?.snapshot();
    if (session) {
      if (isAuthorizing(session)) return { configured: true, status: 'authorizing', session };
      if (session.status === 'failed' || session.status === 'expired') {
        return { configured: true, status: 'error', session };
      }
      if (session.status === 'connected') return { configured: true, status: 'connected', session };
    }
    const record = await this.store.load(resolved.url);
    return { configured: true, status: record?.tokens ? 'connected' : 'disconnected', session };
  }

  async start(params: StartMcpOAuthParams): Promise<McpOAuthStatus> {
    const rawServer = await resolveConnectorSecretReferences(params.rawServer);
    const resolvedConfig = resolveMcpTransportConfig(params.serverId, rawServer);
    if (!resolvedConfig || resolvedConfig.kind !== 'http' || !resolvedConfig.auth) {
      throw new Error(`MCP server "${params.serverId}" is not configured for OAuth`);
    }

    const serverUrl = new URL(resolvedConfig.url);
    const sessionKey = canonicalMcpServerUrl(serverUrl);
    const previous = this.sessionsByServerUrl.get(sessionKey);
    if (previous && isAuthorizing(previous.snapshot())) return this.status(params.serverId, params.rawServer);
    if (previous) await previous.close();

    const session = new McpOAuthSession(params.serverId, serverUrl);
    this.sessionsByServerUrl.set(sessionKey, session);
    try {
      await session.start();
    } catch (error) {
      this.sessionsByServerUrl.delete(sessionKey);
      throw error;
    }
    try {
      await this.store.update(serverUrl, (current) => current ? {
        ...current,
        clientInformation: undefined,
        tokens: undefined,
        tokensSavedAt: undefined,
      } : undefined);
    } catch (error) {
      session.fail(error);
      throw error;
    }

    let provider: XopcMcpOAuthClientProvider;
    let resolved: ResolvedMcpTransport | null;
    try {
      provider = new XopcMcpOAuthClientProvider({
        serverUrl,
        clientId: resolvedConfig.auth.clientId,
        store: this.store,
        interaction: {
          redirectUrl: session.redirectUrl,
          state: session.state,
          onRedirect: (authorizationUrl) => session.setAuthorizationUrl(authorizationUrl),
        },
      });
      resolved = await resolveMcpTransport(
        params.serverId,
        rawServer,
        params.cfg,
        { oauthProvider: provider, oauthStore: this.store },
      );
    } catch (error) {
      session.fail(error);
      return this.status(params.serverId, params.rawServer);
    }
    if (!resolved || resolved.transportType !== 'streamable-http') {
      session.fail(new Error('MCP OAuth requires a streamable HTTP transport'));
      await resolved?.transport.close().catch(() => {});
      return this.status(params.serverId, params.rawServer);
    }

    const client = createClient();
    try {
      await connectClient(client, resolved);
      session.complete();
      await closeConnection(client, resolved);
      await disposeAllSessionMcpRuntimes();
    } catch (error) {
      if (!isMcpAuthorizationError(error) || !session.snapshot().authorizationUrl) {
        session.fail(error);
        await closeConnection(client, resolved);
      } else {
        void this.finishAuthorization({ session, provider, client, resolved, params: { ...params, rawServer } });
      }
    }
    return this.status(params.serverId, params.rawServer);
  }

  async disconnect(serverId: string, rawServer: unknown): Promise<McpOAuthStatus> {
    const resolved = resolveMcpTransportConfig(serverId, rawServer);
    if (!resolved || resolved.kind !== 'http' || !resolved.auth) {
      throw new Error(`MCP server "${serverId}" is not configured for OAuth`);
    }
    const sessionKey = canonicalMcpServerUrl(resolved.url);
    const session = this.sessionsByServerUrl.get(sessionKey);
    this.sessionsByServerUrl.delete(sessionKey);
    if (session) await session.close();
    await this.store.delete(resolved.url);
    await disposeAllSessionMcpRuntimes();
    return { configured: true, status: 'disconnected' };
  }

  private async finishAuthorization(context: {
    session: McpOAuthSession;
    provider: XopcMcpOAuthClientProvider;
    client: Client;
    resolved: ResolvedMcpTransport;
    params: StartMcpOAuthParams;
  }): Promise<void> {
    const { session, provider, client, resolved, params } = context;
    try {
      const code = await session.waitForCode();
      await (resolved.transport as StreamableHTTPClientTransport).finishAuth(code);
      if (session.snapshot().status === 'cancelled') {
        await this.store.delete(session.serverUrl);
        await closeConnection(client, resolved);
        return;
      }
      await closeConnection(client, resolved);

      const authenticated = await resolveMcpTransport(
        params.serverId,
        params.rawServer,
        params.cfg,
        { oauthProvider: provider, oauthStore: this.store },
      );
      if (!authenticated) throw new Error('MCP transport could not be created after authorization');
      const authenticatedClient = createClient();
      try {
        await connectClient(authenticatedClient, authenticated);
      } finally {
        await closeConnection(authenticatedClient, authenticated);
      }
      session.complete();
      await disposeAllSessionMcpRuntimes();
    } catch (error) {
      if (session.snapshot().status === 'cancelled') {
        await this.store.delete(session.serverUrl);
        await closeConnection(client, resolved);
        return;
      }
      session.fail(error);
      await closeConnection(client, resolved);
      log.warn(
        { err: error, phase: 'mcp.oauth_finish', serverId: params.serverId },
        `MCP OAuth failed for server "${params.serverId}": ${redactSensitiveUrlLikeString(error instanceof Error ? error.message : String(error))}`,
      );
    }
  }
}

export function getMcpOAuthManager(): McpOAuthManager {
  return resolveGlobalSingleton(MCP_OAUTH_MANAGER_KEY, () => new McpOAuthManager());
}
