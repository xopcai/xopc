import type { OAuthDiscoveryState } from '@modelcontextprotocol/sdk/client/auth.js';
import type { OAuthClientInformationMixed, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';

export type McpOAuthRecord = {
  version: 1;
  serverUrl: string;
  clientInformation?: OAuthClientInformationMixed;
  discoveryState?: OAuthDiscoveryState;
  tokens?: OAuthTokens;
  tokensSavedAt?: number;
  updatedAt: string;
};

export type McpOAuthSessionStatus =
  | 'starting'
  | 'waiting_browser'
  | 'exchanging_code'
  | 'connected'
  | 'failed'
  | 'expired'
  | 'cancelled';

export type McpOAuthSessionSnapshot = {
  id: string;
  serverId: string;
  serverUrl: string;
  status: McpOAuthSessionStatus;
  authorizationUrl?: string;
  error?: string;
  createdAt: number;
  expiresAt: number;
};
