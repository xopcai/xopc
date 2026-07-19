import { randomUUID } from 'node:crypto';

import { GITHUB_APP_CLIENT_ID, GITHUB_APP_SLUG } from '../generated/github-app-registration.js';
import { createLogger } from '../utils/logger.js';
import { GitHubTokenVault, type GitHubAppToken } from './github-token-vault.js';
import type { ConnectorDefinition } from './types.js';

const log = createLogger('Connector:GitHub');
const GITHUB_DEVICE_CODE_URL = 'https://github.com/login/device/code';
const GITHUB_ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const GITHUB_INSTALLATIONS_URL = 'https://api.github.com/user/installations?per_page=100';
const TOKEN_REFRESH_LEEWAY_MS = 5 * 60_000;

type GitHubRegistration = { clientId: string; slug: string };
type GitHubDeviceCodeResponse = {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval?: number;
};
type GitHubTokenResponse = {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
  token_type?: string;
  scope?: string;
  error?: string;
  error_description?: string;
  interval?: number;
};
type GitHubInstallationResponse = { installations?: Array<{ app_slug?: string }> };

export type GitHubDeviceFlowStatus = 'pending' | 'installation_required' | 'connected' | 'expired' | 'error';
export type GitHubDeviceFlowStart = {
  connectorId: string;
  provider: 'github-app';
  flowId: string;
  userCode: string;
  verificationUri: string;
  expiresInSeconds: number;
  intervalSeconds: number;
  status: 'pending';
  installUrl: string;
};
export type GitHubDeviceFlowResult = {
  connectorId: string;
  provider: 'github-app';
  flowId: string;
  status: GitHubDeviceFlowStatus;
  installUrl: string;
  error?: string;
};

type PendingFlow = {
  deviceCode: string;
  expiresAt: number;
  intervalMs: number;
  status: GitHubDeviceFlowStatus;
  error?: string;
};

const pendingFlows = new Map<string, PendingFlow>();
let refreshInFlight: Promise<GitHubAppToken> | undefined;

function defaultRegistration(): GitHubRegistration {
  return { clientId: GITHUB_APP_CLIENT_ID.trim(), slug: GITHUB_APP_SLUG.trim() };
}

function assertRegistration(registration: GitHubRegistration): void {
  if (!registration.clientId || !registration.slug) {
    throw new Error('This xopc build does not contain a GitHub App registration. Configure it at release build time.');
  }
}

function assertGitHubConnector(definition: ConnectorDefinition): void {
  if (
    definition.auth.mode !== 'oauth' ||
    definition.auth.provider !== 'github-app' ||
    !definition.capabilities.includes('auth.oauth')
  ) {
    throw new Error(`Connector "${definition.id}" does not support GitHub App authorization.`);
  }
}

function installUrl(registration: GitHubRegistration): string {
  return `https://github.com/apps/${encodeURIComponent(registration.slug)}/installations/new`;
}

async function readJsonResponse<T>(response: Response, context: string): Promise<T> {
  const text = await response.text();
  let data: unknown = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error_description: text };
  }
  if (!response.ok) {
    const row = data as { error_description?: string; error?: string };
    throw new Error(`${context}: ${row.error_description ?? row.error ?? response.statusText}`);
  }
  return data as T;
}

function tokenFromResponse(data: GitHubTokenResponse, now: number, previous?: GitHubAppToken): GitHubAppToken {
  if (!data.access_token || !data.refresh_token || !data.expires_in || !data.refresh_token_expires_in) {
    throw new Error('GitHub App token response did not include expiring access and refresh tokens.');
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: now + data.expires_in * 1000,
    refreshTokenExpiresAt: now + data.refresh_token_expires_in * 1000,
    tokenType: data.token_type ?? 'bearer',
    scope: data.scope?.split(/\s+/).filter(Boolean) ?? [],
    createdAt: previous?.createdAt ?? new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
  };
}

async function exchangeDeviceCode(deviceCode: string, registration: GitHubRegistration): Promise<GitHubTokenResponse> {
  const response = await fetch(GITHUB_ACCESS_TOKEN_URL, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: registration.clientId,
      device_code: deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    }),
  });
  return await readJsonResponse<GitHubTokenResponse>(response, 'GitHub token exchange failed');
}

async function hasGitHubAppInstallation(accessToken: string, registration: GitHubRegistration): Promise<boolean> {
  const response = await fetch(GITHUB_INSTALLATIONS_URL, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${accessToken}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  const data = await readJsonResponse<GitHubInstallationResponse>(response, 'GitHub App installation check failed');
  return data.installations?.some((installation) => installation.app_slug === registration.slug) ?? false;
}

async function pollDeviceFlow(
  flowId: string,
  registration: GitHubRegistration,
  vault: GitHubTokenVault,
): Promise<void> {
  const flow = pendingFlows.get(flowId);
  if (!flow) return;
  let intervalMs = flow.intervalMs;
  while (Date.now() < flow.expiresAt) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    const current = pendingFlows.get(flowId);
    if (!current || current.status !== 'pending') return;
    try {
      const data = await exchangeDeviceCode(current.deviceCode, registration);
      if (data.error === 'authorization_pending') continue;
      if (data.error === 'slow_down') {
        intervalMs += 5_000;
        current.intervalMs = intervalMs;
        continue;
      }
      if (data.error) {
        current.status = data.error === 'expired_token' ? 'expired' : 'error';
        current.error = data.error_description ?? data.error;
        return;
      }
      const token = tokenFromResponse(data, Date.now());
      await vault.save(token);
      current.status = (await hasGitHubAppInstallation(token.accessToken, registration))
        ? 'connected'
        : 'installation_required';
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.warn({ errorMessage: message, phase: 'device_flow_poll' }, `GitHub device authorization failed: ${message}`);
      current.status = 'error';
      current.error = message;
      return;
    }
  }
  const current = pendingFlows.get(flowId);
  if (current?.status === 'pending') current.status = 'expired';
}

export async function startGitHubDeviceFlow(
  definition: ConnectorDefinition,
  options: { registration?: GitHubRegistration; vault?: GitHubTokenVault } = {},
): Promise<GitHubDeviceFlowStart> {
  assertGitHubConnector(definition);
  const registration = options.registration ?? defaultRegistration();
  assertRegistration(registration);
  const vault = options.vault ?? new GitHubTokenVault();
  // Fail before asking the user to authorize when secure storage is unavailable.
  vault.assertAvailable();
  const response = await fetch(GITHUB_DEVICE_CODE_URL, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: registration.clientId }),
  });
  const data = await readJsonResponse<GitHubDeviceCodeResponse>(response, 'GitHub device authorization failed');
  const flowId = randomUUID();
  const intervalSeconds = Math.max(1, data.interval ?? 5);
  pendingFlows.set(flowId, {
    deviceCode: data.device_code,
    expiresAt: Date.now() + data.expires_in * 1000,
    intervalMs: intervalSeconds * 1000,
    status: 'pending',
  });
  void pollDeviceFlow(flowId, registration, vault);
  return {
    connectorId: definition.id,
    provider: 'github-app',
    flowId,
    userCode: data.user_code,
    verificationUri: data.verification_uri,
    expiresInSeconds: data.expires_in,
    intervalSeconds,
    status: 'pending',
    installUrl: installUrl(registration),
  };
}

export async function getGitHubDeviceFlowStatus(
  definition: ConnectorDefinition,
  flowId: string,
  options: { registration?: GitHubRegistration; vault?: GitHubTokenVault } = {},
): Promise<GitHubDeviceFlowResult> {
  assertGitHubConnector(definition);
  const registration = options.registration ?? defaultRegistration();
  assertRegistration(registration);
  const flow = pendingFlows.get(flowId);
  if (!flow) throw new Error('GitHub device authorization flow was not found.');
  if (flow.status === 'installation_required') {
    const token = await getGitHubAccessToken({ registration, vault: options.vault });
    if (await hasGitHubAppInstallation(token, registration)) flow.status = 'connected';
  }
  return {
    connectorId: definition.id,
    provider: 'github-app',
    flowId,
    status: flow.status,
    installUrl: installUrl(registration),
    ...(flow.error ? { error: flow.error } : {}),
  };
}

async function refreshGitHubToken(
  token: GitHubAppToken,
  registration: GitHubRegistration,
  vault: GitHubTokenVault,
): Promise<GitHubAppToken> {
  if (token.refreshTokenExpiresAt <= Date.now()) {
    throw new Error('GitHub authorization expired. Connect GitHub again.');
  }
  const response = await fetch(GITHUB_ACCESS_TOKEN_URL, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: registration.clientId,
      grant_type: 'refresh_token',
      refresh_token: token.refreshToken,
    }),
  });
  const data = await readJsonResponse<GitHubTokenResponse>(response, 'GitHub token refresh failed');
  if (data.error) throw new Error(data.error_description ?? data.error);
  const refreshed = tokenFromResponse(data, Date.now(), token);
  await vault.save(refreshed);
  return refreshed;
}

export async function getGitHubAccessToken(
  options: { forceRefresh?: boolean; registration?: GitHubRegistration; vault?: GitHubTokenVault } = {},
): Promise<string> {
  const registration = options.registration ?? defaultRegistration();
  assertRegistration(registration);
  const vault = options.vault ?? new GitHubTokenVault();
  const token = await vault.load();
  if (!token) throw new Error('Connect GitHub before using the GitHub connector.');
  if (!options.forceRefresh && token.expiresAt > Date.now() + TOKEN_REFRESH_LEEWAY_MS) {
    return token.accessToken;
  }
  refreshInFlight ??= refreshGitHubToken(token, registration, vault).finally(() => {
    refreshInFlight = undefined;
  });
  return (await refreshInFlight).accessToken;
}

export async function assertGitHubConnectorReady(definition: ConnectorDefinition): Promise<void> {
  assertGitHubConnector(definition);
  const registration = defaultRegistration();
  const accessToken = await getGitHubAccessToken({ registration });
  if (!(await hasGitHubAppInstallation(accessToken, registration))) {
    throw new Error(`Install the xopc GitHub App before installing this connector: ${installUrl(registration)}`);
  }
}

export const __testing = {
  clearFlows() {
    pendingFlows.clear();
    refreshInFlight = undefined;
  },
};
