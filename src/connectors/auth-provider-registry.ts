import {
  assertGitHubConnectorReady,
  getGitHubAccessToken,
  getGitHubDeviceFlowStatus,
  startGitHubDeviceFlow,
} from './github-app-oauth.js';
import { startComposioAuthorize } from './composio.js';
import type { ConnectorDefinition } from './types.js';

export type ConnectorAuthStartResult = {
  connectorId: string;
  provider: string;
  status: string;
  flowId?: string;
  userCode?: string;
  verificationUri?: string;
  authorizationUrl?: string;
  installUrl?: string;
  connectionId?: string;
  expiresInSeconds?: number;
  intervalSeconds?: number;
};

export type ConnectorAuthStatusResult = {
  connectorId: string;
  provider: string;
  flowId: string;
  status: string;
  installUrl?: string;
  error?: string;
};

export type ConnectorAuthProvider = {
  id: string;
  start(definition: ConnectorDefinition): Promise<ConnectorAuthStartResult>;
  status?(definition: ConnectorDefinition, flowId: string): Promise<ConnectorAuthStatusResult>;
  assertReady?(definition: ConnectorDefinition): Promise<void>;
  getAccessToken?(options?: { forceRefresh?: boolean }): Promise<string>;
};

const providers = new Map<string, ConnectorAuthProvider>();

export function registerConnectorAuthProvider(provider: ConnectorAuthProvider): void {
  if (providers.has(provider.id)) throw new Error(`Connector auth provider is already registered: ${provider.id}`);
  providers.set(provider.id, provider);
}

registerConnectorAuthProvider({
  id: 'github-app',
  start: startGitHubDeviceFlow,
  status: getGitHubDeviceFlowStatus,
  assertReady: assertGitHubConnectorReady,
  getAccessToken: getGitHubAccessToken,
});

registerConnectorAuthProvider({
  id: 'composio',
  async start(definition) {
    if (definition.runtime.type !== 'composio' || definition.runtime.role !== 'toolkit') {
      throw new Error(`Connector "${definition.id}" does not support Composio authorization.`);
    }
    const authorization = await startComposioAuthorize(definition.id, definition.runtime.toolkit);
    return {
      connectorId: definition.id,
      provider: 'composio',
      status: 'pending',
      authorizationUrl: authorization.connectUrl,
      connectionId: authorization.connectionId,
    };
  },
});

function providerForDefinition(definition: ConnectorDefinition): ConnectorAuthProvider {
  if (definition.auth.mode !== 'oauth' || !definition.auth.provider) {
    throw new Error(`Connector "${definition.id}" does not define an OAuth provider.`);
  }
  const provider = providers.get(definition.auth.provider);
  if (!provider) throw new Error(`Unknown connector auth provider: ${definition.auth.provider}`);
  return provider;
}

export async function startConnectorAuthorization(definition: ConnectorDefinition): Promise<ConnectorAuthStartResult> {
  return await providerForDefinition(definition).start(definition);
}

export async function getConnectorAuthorizationStatus(
  definition: ConnectorDefinition,
  flowId: string,
): Promise<ConnectorAuthStatusResult> {
  const provider = providerForDefinition(definition);
  if (!provider.status) throw new Error(`Connector auth provider "${provider.id}" does not expose flow status.`);
  return await provider.status(definition, flowId);
}

export async function assertConnectorAuthorizationReady(definition: ConnectorDefinition): Promise<void> {
  if (definition.auth.mode !== 'oauth' || definition.auth.installPhase !== 'before_install') return;
  const provider = providerForDefinition(definition);
  if (!provider.assertReady) {
    throw new Error(`Connector auth provider "${provider.id}" cannot verify installation readiness.`);
  }
  await provider.assertReady(definition);
}

export async function getConnectorAuthAccessToken(
  providerId: string,
  options: { forceRefresh?: boolean } = {},
): Promise<string> {
  const provider = providers.get(providerId);
  if (!provider) throw new Error(`Unknown connector auth provider: ${providerId}`);
  if (!provider.getAccessToken) throw new Error(`Connector auth provider "${providerId}" does not expose access tokens.`);
  return await provider.getAccessToken(options);
}
