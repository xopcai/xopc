import { apiUrl } from '@/lib/url';
import { fetchJson } from '@/lib/fetch';

export interface McpConnectionStatsDto {
  connectionId: string;
  totalCalls: number;
  errorCount: number;
  lastUsedAt: number;
  toolCounts: Record<string, number>;
  errorCodes: Record<string, number>;
}

export interface McpToolsetDto {
  id: string;
  label: string;
  description: string;
  includesWrite: boolean;
  capabilityIds: string[];
}

export interface McpLocalGrantDto {
  connectionId: string;
  capabilityIds: string[];
  name?: string;
  toolset?: string;
  projectIds?: string[];
  maxConcurrentRuns?: number;
  hasCallback: boolean;
  callbackUrl?: string;
  createdAt?: number;
  expiresAt?: number;
  expired: boolean;
  stats: McpConnectionStatsDto | null;
}

export interface McpRemoteGrantDto {
  connectionId: string;
  name?: string;
  toolset?: string;
  subject: string;
  clientId: string;
  issuer: string;
  resource: string;
  capabilityIds: string[];
  projectIds?: string[];
  maxConcurrentRuns?: number;
  hasCallback: boolean;
  callbackUrl?: string;
  grantedAt: number;
  expiresAt?: number;
  stats: McpConnectionStatsDto | null;
}

export interface McpOAuthClientDto {
  clientId: string;
  clientName: string;
  redirectUris: string[];
  tokenEndpointAuthMethod: string;
  createdAt: number;
}

export interface McpClientSnippetsDto {
  claudeDesktop: string;
  cursor: string;
  codexToml: string;
  claudeCodeCli: string;
  remoteUrl?: string;
  codexRemoteCli?: string;
  claudeCodeRemoteCli?: string;
}

export interface McpServerOverviewDto {
  gatewayPort: number;
  remote:
    | {
        enabled: true;
        mode: 'builtin' | 'external';
        resource: string;
        issuer: string;
        jwksUrl?: string;
        allowedOrigins: string[];
        acceptedTokenTypes: string[];
        clientIdClaims: string[];
        requireJti: boolean;
        rateLimitMax: number;
        rateLimitWindowMs: number;
        metadataUrl: string;
        oauthAsMetadataUrl?: string;
      }
    | {
        enabled: false;
        suggestedResource: string;
      };
  suggestedRemoteResource: string;
  toolsets: McpToolsetDto[];
  allCapabilities: string[];
  readCapabilities: string[];
  projects: Array<{ id: string; name: string }>;
  localGrants: McpLocalGrantDto[];
  remoteGrants: McpRemoteGrantDto[];
  oauthClients: McpOAuthClientDto[];
  snippets: McpClientSnippetsDto;
}

export interface McpAuditEntryDto {
  id: string;
  at: number;
  transport: 'stdio' | 'remote';
  principalId: string;
  connectionId: string;
  capabilityId: string;
  status: string;
  durationMs: number;
  operationId?: string;
}

export interface CreatedLocalGrantDto {
  connectionId: string;
  token: string;
  capabilityIds: string[];
  toolset?: string;
  projectIds?: string[];
  expiresAt?: number;
  snippets: McpClientSnippetsDto;
}

export async function fetchMcpServerOverview(): Promise<McpServerOverviewDto> {
  const res = await fetchJson<{ ok: boolean; payload: McpServerOverviewDto }>(apiUrl('/api/mcp-server/overview'));
  return res.payload;
}

export async function fetchMcpServerAudit(connectionId?: string, limit = 50): Promise<{
  entries: McpAuditEntryDto[];
  stats: Record<string, McpConnectionStatsDto>;
}> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (connectionId) params.set('connectionId', connectionId);
  const res = await fetchJson<{
    ok: boolean;
    payload: { entries: McpAuditEntryDto[]; stats: Record<string, McpConnectionStatsDto> };
  }>(apiUrl(`/api/mcp-server/audit?${params.toString()}`));
  return res.payload;
}

export async function createLocalMcpGrant(input: {
  name?: string;
  toolset?: string;
  projectIds?: string[];
  expiresInDays?: number;
  maxConcurrentRuns?: number;
}): Promise<CreatedLocalGrantDto> {
  const res = await fetchJson<{ ok: boolean; payload: CreatedLocalGrantDto }>(apiUrl('/api/mcp-server/grants/local'), {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return res.payload;
}

export async function revokeLocalMcpGrant(connectionId: string): Promise<void> {
  await fetchJson<{ ok: boolean }>(apiUrl(`/api/mcp-server/grants/local/${encodeURIComponent(connectionId)}`), {
    method: 'DELETE',
  });
}

export async function revokeRemoteMcpGrantApi(connectionId: string): Promise<void> {
  await fetchJson<{ ok: boolean }>(apiUrl(`/api/mcp-server/grants/remote/${encodeURIComponent(connectionId)}`), {
    method: 'DELETE',
  });
}

export async function deleteOAuthClientApi(clientId: string): Promise<void> {
  await fetchJson<{ ok: boolean }>(apiUrl(`/api/mcp-server/oauth-clients/${encodeURIComponent(clientId)}`), {
    method: 'DELETE',
  });
}

export async function saveRemoteMcpConfig(input: {
  enabled: boolean;
  config?: {
    mode: 'builtin' | 'external';
    resource: string;
    issuer?: string;
    jwksUrl?: string;
    allowedOrigins?: string[];
    acceptedTokenTypes?: string[];
    clientIdClaims?: string[];
    requireJti?: boolean;
    rateLimitMax?: number;
    rateLimitWindowMs?: number;
  };
}): Promise<void> {
  await fetchJson<{ ok: boolean }>(apiUrl('/api/mcp-server/config'), {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}
