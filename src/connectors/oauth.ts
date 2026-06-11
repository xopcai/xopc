import { CredentialResolver } from '../auth/credentials.js';
import { connectorSecretProviderId } from './secret-store.js';
import type { ConnectorDefinition } from './types.js';

export type ConnectorOAuthStartResult = {
  connectorId: string;
  provider: 'github';
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresInSeconds: number;
  intervalSeconds: number;
};

export type ConnectorOAuthCompleteResult = {
  connectorId: string;
  provider: 'github';
  connected: true;
};

type GitHubDeviceCodeResponse = {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval?: number;
};

type GitHubTokenResponse = {
  access_token?: string;
  token_type?: string;
  scope?: string;
  error?: string;
  error_description?: string;
  interval?: number;
};

const GITHUB_DEVICE_CODE_URL = 'https://github.com/login/device/code';
const GITHUB_ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const GITHUB_OAUTH_FIELD_KEY = 'GITHUB_PERSONAL_ACCESS_TOKEN';
const DEFAULT_GITHUB_SCOPES = ['repo', 'read:user', 'read:org'];

function githubOAuthClientId(): string {
  const clientId = process.env.XOPC_GITHUB_OAUTH_CLIENT_ID?.trim() ?? '';
  if (!clientId) {
    throw new Error('GitHub OAuth is not configured. Set XOPC_GITHUB_OAUTH_CLIENT_ID to enable GitHub Connect.');
  }
  return clientId;
}

function assertConnectorSupportsOAuth(definition: ConnectorDefinition): void {
  if (definition.auth.mode !== 'oauth' || !definition.capabilities.includes('auth.oauth')) {
    throw new Error(`Connector "${definition.id}" does not support OAuth.`);
  }
  if (definition.id !== 'github') {
    throw new Error(`OAuth provider is not implemented for connector: ${definition.id}`);
  }
}

async function readJsonResponse<T>(response: Response, context: string): Promise<T> {
  const data = await response.json().catch(async () => ({ error_description: await response.text() }));
  if (!response.ok) {
    const errorData = data as { error_description?: string; error?: string };
    throw new Error(`${context}: ${errorData.error_description ?? errorData.error ?? response.statusText}`);
  }
  return data as T;
}

export function githubConnectorOAuthCredentialProviderId(definition: ConnectorDefinition): string {
  return connectorSecretProviderId(definition.id, GITHUB_OAUTH_FIELD_KEY);
}

export async function assertConnectorOAuthReady(
  definition: ConnectorDefinition,
  resolver = new CredentialResolver(),
): Promise<void> {
  if (definition.auth.mode !== 'oauth') {
    return;
  }
  assertConnectorSupportsOAuth(definition);
  const token = await resolver.loadOAuthToken(githubConnectorOAuthCredentialProviderId(definition));
  if (!token?.access) {
    throw new Error(`Connect ${definition.displayName} with OAuth before installing this connector.`);
  }
}

export async function startConnectorOAuth(definition: ConnectorDefinition): Promise<ConnectorOAuthStartResult> {
  assertConnectorSupportsOAuth(definition);
  const clientId = githubOAuthClientId();
  const response = await fetch(GITHUB_DEVICE_CODE_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      client_id: clientId,
      scope: DEFAULT_GITHUB_SCOPES.join(' '),
    }),
  });
  const data = await readJsonResponse<GitHubDeviceCodeResponse>(response, 'GitHub device authorization failed');
  return {
    connectorId: definition.id,
    provider: 'github',
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUri: data.verification_uri,
    expiresInSeconds: data.expires_in,
    intervalSeconds: data.interval ?? 5,
  };
}

export async function completeConnectorOAuth(
  definition: ConnectorDefinition,
  params: { deviceCode: string },
  resolver = new CredentialResolver(),
): Promise<ConnectorOAuthCompleteResult> {
  assertConnectorSupportsOAuth(definition);
  const deviceCode = params.deviceCode.trim();
  if (!deviceCode) {
    throw new Error('Missing GitHub OAuth device code.');
  }

  const response = await fetch(GITHUB_ACCESS_TOKEN_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      client_id: githubOAuthClientId(),
      device_code: deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    }),
  });
  const data = await readJsonResponse<GitHubTokenResponse>(response, 'GitHub token exchange failed');
  if (data.error) {
    if (data.error === 'authorization_pending') {
      throw new Error('GitHub authorization is still pending. Complete the browser step and try again.');
    }
    if (data.error === 'slow_down') {
      throw new Error('GitHub asked us to slow down. Wait a few seconds and try again.');
    }
    throw new Error(data.error_description ?? data.error);
  }
  if (!data.access_token) {
    throw new Error('GitHub token exchange did not return an access token.');
  }

  await resolver.saveOAuthToken(githubConnectorOAuthCredentialProviderId(definition), {
    access: data.access_token,
    refresh: '',
    scope: data.scope?.split(/\s+/).filter(Boolean),
    createdAt: new Date().toISOString(),
  });
  return {
    connectorId: definition.id,
    provider: 'github',
    connected: true,
  };
}
