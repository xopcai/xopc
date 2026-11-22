import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { exportJWK, generateKeyPair, importJWK, jwtVerify, SignJWT, type JWK } from 'jose';
import { z } from 'zod';

import { DurableState } from '../storage/sqlite/durable-state.js';
import { MCP_OAUTH_BASE_PATH, MCP_READ_SCOPE, MCP_WRITE_SCOPE } from './remote-config.js';
import { findRemoteMcpGrant, grantRemoteMcpConnection, revokeRemoteMcpConnection, type RemoteMcpIdentity } from './remote-grants.js';
import { resolveMcpToolsetCapabilities } from './product-tools.js';

export const BUILTIN_OAUTH_SUBJECT = 'xopc-owner';
const ACCESS_TOKEN_TTL_SEC = 15 * 60;
const AUTH_CODE_TTL_MS = 5 * 60 * 1_000;
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1_000;

interface StoredSigningKey {
  kid: string;
  publicJwk: JWK;
  privateJwk: JWK;
  createdAt: number;
}

export interface RegisteredOAuthClient {
  clientId: string;
  clientName: string;
  redirectUris: string[];
  tokenEndpointAuthMethod: 'none' | 'client_secret_post' | 'client_secret_basic';
  clientSecretHash?: string;
  grantTypes: string[];
  responseTypes: string[];
  createdAt: number;
}

interface StoredAuthCode {
  codeHash: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: 'S256';
  resource: string;
  issuer: string;
  subject: string;
  scopes: string[];
  connectionId: string;
  expiresAt: number;
  used: boolean;
}

interface StoredRefreshToken {
  tokenHash: string;
  clientId: string;
  resource: string;
  issuer: string;
  subject: string;
  scopes: string[];
  connectionId: string;
  createdAt: number;
  expiresAt: number;
  revokedAt?: number;
}

const signingKeys = new DurableState<StoredSigningKey>('mcp-oauth-signing-key');
const oauthClients = new DurableState<RegisteredOAuthClient>('mcp-oauth-clients');
const authCodes = new DurableState<StoredAuthCode>('mcp-oauth-codes');
const refreshTokens = new DurableState<StoredRefreshToken>('mcp-oauth-refresh-tokens');

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function sha256Base64Url(value: string): string {
  return createHash('sha256').update(value).digest('base64url');
}

function safeEqualString(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

const redirectUriSchema = z.string().refine(value => {
  const url = URL.parse(value);
  if (!url) return false;
  if (url.hash) return false;
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  return url.protocol === 'https:' || (url.protocol === 'http:' && local);
}, 'Redirect URI must be HTTPS or loopback HTTP without fragment');

export const OAuthClientRegistrationSchema = z.object({
  client_name: z.string().trim().min(1).max(120).optional(),
  redirect_uris: z.array(redirectUriSchema).min(1).max(16),
  token_endpoint_auth_method: z.enum(['none', 'client_secret_post', 'client_secret_basic']).default('none'),
  grant_types: z.array(z.enum(['authorization_code', 'refresh_token'])).default(['authorization_code', 'refresh_token']),
  response_types: z.array(z.literal('code')).default(['code']),
});

async function getOrCreateSigningKey(): Promise<StoredSigningKey> {
  const existing = signingKeys.get('primary');
  if (existing) return existing;
  const { publicKey, privateKey } = await generateKeyPair('ES256', { extractable: true });
  const kid = `xopc-mcp-${randomBytes(8).toString('hex')}`;
  const publicJwk = { ...await exportJWK(publicKey), kid, alg: 'ES256', use: 'sig' };
  const privateJwk = { ...await exportJWK(privateKey), kid, alg: 'ES256', use: 'sig' };
  const stored: StoredSigningKey = { kid, publicJwk, privateJwk, createdAt: Date.now() };
  return signingKeys.update('primary', current => current ? { value: current, result: current } : { value: stored, result: stored });
}

export async function getBuiltinOAuthJwks(): Promise<{ keys: JWK[] }> {
  const key = await getOrCreateSigningKey();
  return { keys: [key.publicJwk] };
}

export function buildBuiltinOAuthAsMetadata(resource: string) {
  const origin = new URL(resource).origin;
  const base = `${origin}${MCP_OAUTH_BASE_PATH}`;
  return {
    issuer: origin,
    authorization_endpoint: `${base}/authorize`,
    token_endpoint: `${base}/token`,
    jwks_uri: `${base}/jwks`,
    registration_endpoint: `${base}/register`,
    revocation_endpoint: `${base}/revoke`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
    scopes_supported: [MCP_READ_SCOPE, MCP_WRITE_SCOPE],
    client_id_metadata_document_supported: false,
  };
}

export function registerBuiltinOAuthClient(rawInput: unknown): {
  client: RegisteredOAuthClient;
  clientSecret?: string;
} {
  const parsed = OAuthClientRegistrationSchema.parse(rawInput);
  const clientId = `xopc_client_${randomBytes(12).toString('base64url')}`;
  const needsSecret = parsed.token_endpoint_auth_method !== 'none';
  const clientSecret = needsSecret ? `xopc_secret_${randomBytes(24).toString('base64url')}` : undefined;
  const client: RegisteredOAuthClient = {
    clientId,
    clientName: parsed.client_name ?? 'External MCP Client',
    redirectUris: [...new Set(parsed.redirect_uris)],
    tokenEndpointAuthMethod: parsed.token_endpoint_auth_method,
    ...(clientSecret ? { clientSecretHash: sha256Hex(clientSecret) } : {}),
    grantTypes: [...new Set(parsed.grant_types)],
    responseTypes: [...new Set(parsed.response_types)],
    createdAt: Date.now(),
  };
  oauthClients.set(clientId, client);
  return { client, ...(clientSecret ? { clientSecret } : {}) };
}

export function getBuiltinOAuthClient(clientId: string): RegisteredOAuthClient | undefined {
  return oauthClients.get(clientId);
}

export function listBuiltinOAuthClients(): RegisteredOAuthClient[] {
  return oauthClients.values().sort((a, b) => b.createdAt - a.createdAt);
}

export function deleteBuiltinOAuthClient(clientId: string): boolean {
  if (!oauthClients.get(clientId)) return false;
  oauthClients.delete(clientId);
  return true;
}

export function approveBuiltinOAuthAuthorization(params: {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  resource: string;
  scopes: string[];
  toolset?: string;
  projectIds?: string[];
  label?: string;
}): { code: string; connectionId: string } {
  const client = getBuiltinOAuthClient(params.clientId);
  if (!client) throw new Error('Unknown OAuth client');
  if (!client.redirectUris.includes(params.redirectUri)) throw new Error('Redirect URI does not match registered client');
  if (!params.codeChallenge || params.codeChallenge.length < 43 || params.codeChallenge.length > 128) {
    throw new Error('Valid PKCE S256 code_challenge is required');
  }
  const normalizedScopes = params.scopes.filter(s => s === MCP_READ_SCOPE || s === MCP_WRITE_SCOPE);
  if (!normalizedScopes.includes(MCP_READ_SCOPE)) normalizedScopes.unshift(MCP_READ_SCOPE);
  const includesWrite = normalizedScopes.includes(MCP_WRITE_SCOPE);
  const issuer = new URL(params.resource).origin;

  const toolsetId = params.toolset ?? (includesWrite ? 'full-write' : 'core-read');
  const capabilityIds = resolveMcpToolsetCapabilities(toolsetId, includesWrite);
  const identity: RemoteMcpIdentity = {
    resource: params.resource,
    issuer,
    subject: BUILTIN_OAUTH_SUBJECT,
    clientId: client.clientId,
  };
  const grant = grantRemoteMcpConnection(identity, {
    write: includesWrite,
    capabilityIds,
    name: params.label ?? client.clientName,
    toolset: toolsetId,
    projectIds: params.projectIds,
    replaceExisting: true,
  });

  const code = randomBytes(32).toString('base64url');
  const codeHash = sha256Hex(code);
  authCodes.set(codeHash, {
    codeHash,
    clientId: client.clientId,
    redirectUri: params.redirectUri,
    codeChallenge: params.codeChallenge,
    codeChallengeMethod: 'S256',
    resource: params.resource,
    issuer,
    subject: BUILTIN_OAUTH_SUBJECT,
    scopes: normalizedScopes,
    connectionId: grant.connectionId,
    expiresAt: Date.now() + AUTH_CODE_TTL_MS,
    used: false,
  });
  return { code, connectionId: grant.connectionId };
}

function verifyClientAuth(client: RegisteredOAuthClient, clientSecret?: string): boolean {
  if (client.tokenEndpointAuthMethod === 'none') return true;
  if (!client.clientSecretHash || !clientSecret) return false;
  return safeEqualString(client.clientSecretHash, sha256Hex(clientSecret));
}

async function mintAccessToken(params: {
  issuer: string;
  resource: string;
  subject: string;
  clientId: string;
  scopes: string[];
}): Promise<string> {
  const key = await getOrCreateSigningKey();
  const privateKey = await importJWK(key.privateJwk, 'ES256');
  return new SignJWT({
    client_id: params.clientId,
    scope: params.scopes.join(' '),
  })
    .setProtectedHeader({ alg: 'ES256', kid: key.kid, typ: 'at+jwt' })
    .setIssuer(params.issuer)
    .setAudience(params.resource)
    .setSubject(params.subject)
    .setIssuedAt()
    .setJti(randomUUID())
    .setExpirationTime(`${ACCESS_TOKEN_TTL_SEC}s`)
    .sign(privateKey);
}

function issueRefreshToken(record: Omit<StoredRefreshToken, 'tokenHash' | 'createdAt' | 'expiresAt'>): string {
  const token = `xopc_rt_${randomBytes(32).toString('base64url')}`;
  const tokenHash = sha256Hex(token);
  const now = Date.now();
  refreshTokens.set(tokenHash, {
    ...record,
    tokenHash,
    createdAt: now,
    expiresAt: now + REFRESH_TOKEN_TTL_MS,
  });
  return token;
}

export async function exchangeBuiltinOAuthCode(params: {
  code: string;
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
  codeVerifier: string;
  resource?: string;
}): Promise<{ access_token: string; token_type: 'Bearer'; expires_in: number; scope: string; refresh_token: string }> {
  const client = getBuiltinOAuthClient(params.clientId);
  if (!client || !verifyClientAuth(client, params.clientSecret)) {
    throw new Error('invalid_client');
  }
  const codeHash = sha256Hex(params.code);
  const stored = authCodes.get(codeHash);
  if (!stored || stored.used || stored.expiresAt <= Date.now()) {
    throw new Error('invalid_grant');
  }
  if (stored.clientId !== params.clientId || stored.redirectUri !== params.redirectUri) {
    throw new Error('invalid_grant');
  }
  if (params.resource && params.resource !== stored.resource) {
    throw new Error('invalid_target');
  }
  if (!safeEqualString(sha256Base64Url(params.codeVerifier), stored.codeChallenge)) {
    throw new Error('invalid_grant');
  }

  // Mark code single-use immediately
  authCodes.set(codeHash, { ...stored, used: true });

  const grant = findRemoteMcpGrant({
    resource: stored.resource,
    issuer: stored.issuer,
    subject: stored.subject,
    clientId: stored.clientId,
  });
  if (!grant || grant.connectionId !== stored.connectionId) {
    throw new Error('invalid_grant');
  }

  const accessToken = await mintAccessToken({
    issuer: stored.issuer,
    resource: stored.resource,
    subject: stored.subject,
    clientId: stored.clientId,
    scopes: stored.scopes,
  });
  const refreshToken = issueRefreshToken({
    clientId: stored.clientId,
    resource: stored.resource,
    issuer: stored.issuer,
    subject: stored.subject,
    scopes: stored.scopes,
    connectionId: stored.connectionId,
  });
  return {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: ACCESS_TOKEN_TTL_SEC,
    scope: stored.scopes.join(' '),
    refresh_token: refreshToken,
  };
}

export async function refreshBuiltinOAuthToken(params: {
  refreshToken: string;
  clientId: string;
  clientSecret?: string;
  resource?: string;
}): Promise<{ access_token: string; token_type: 'Bearer'; expires_in: number; scope: string; refresh_token: string }> {
  const client = getBuiltinOAuthClient(params.clientId);
  if (!client || !verifyClientAuth(client, params.clientSecret)) {
    throw new Error('invalid_client');
  }
  const tokenHash = sha256Hex(params.refreshToken);
  const stored = refreshTokens.get(tokenHash);
  if (!stored || stored.revokedAt !== undefined || stored.expiresAt <= Date.now() || stored.clientId !== params.clientId) {
    throw new Error('invalid_grant');
  }
  if (params.resource && params.resource !== stored.resource) {
    throw new Error('invalid_target');
  }
  const grant = findRemoteMcpGrant({
    resource: stored.resource,
    issuer: stored.issuer,
    subject: stored.subject,
    clientId: stored.clientId,
  });
  if (!grant || grant.connectionId !== stored.connectionId) {
    refreshTokens.set(tokenHash, { ...stored, revokedAt: Date.now() });
    throw new Error('invalid_grant');
  }

  // Rotate refresh token
  refreshTokens.set(tokenHash, { ...stored, revokedAt: Date.now() });
  const nextRefreshToken = issueRefreshToken({
    clientId: stored.clientId,
    resource: stored.resource,
    issuer: stored.issuer,
    subject: stored.subject,
    scopes: stored.scopes,
    connectionId: stored.connectionId,
  });
  const accessToken = await mintAccessToken({
    issuer: stored.issuer,
    resource: stored.resource,
    subject: stored.subject,
    clientId: stored.clientId,
    scopes: stored.scopes,
  });
  return {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: ACCESS_TOKEN_TTL_SEC,
    scope: stored.scopes.join(' '),
    refresh_token: nextRefreshToken,
  };
}

export function revokeBuiltinOAuthToken(token: string): boolean {
  const tokenHash = sha256Hex(token);
  const stored = refreshTokens.get(tokenHash);
  if (!stored) return false;
  refreshTokens.set(tokenHash, { ...stored, revokedAt: Date.now() });
  revokeRemoteMcpConnection(stored.connectionId);
  return true;
}

export async function verifyBuiltinAccessToken(token: string, resource: string): Promise<{
  identity: RemoteMcpIdentity;
  hasReadScope: boolean;
  hasWriteScope: boolean;
} | undefined> {
  const key = signingKeys.get('primary');
  if (!key) return undefined;
  const issuer = new URL(resource).origin;
  try {
    const publicKey = await importJWK(key.publicJwk, 'ES256');
    const { payload } = await jwtVerify(token, publicKey, {
      issuer,
      audience: resource,
      typ: 'at+jwt',
      algorithms: ['ES256'],
      requiredClaims: ['sub', 'client_id', 'exp', 'iat', 'jti'],
    });
    if (typeof payload.sub !== 'string' || typeof payload.client_id !== 'string') return undefined;
    const scopes = typeof payload.scope === 'string' ? payload.scope.split(' ') : [];
    return {
      identity: { resource, issuer, subject: payload.sub, clientId: payload.client_id },
      hasReadScope: scopes.includes(MCP_READ_SCOPE),
      hasWriteScope: scopes.includes(MCP_WRITE_SCOPE),
    };
  } catch {
    return undefined;
  }
}
