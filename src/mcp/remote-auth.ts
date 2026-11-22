import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify } from 'jose';
import { fetch as undiciFetch } from 'undici';

import { getMcpBearerToken } from './connection-grants.js';
import { verifyBuiltinAccessToken } from './oauth-server.js';
import {
  MCP_READ_SCOPE, MCP_RESOURCE_METADATA_PATH, MCP_WRITE_SCOPE,
  resolveRemoteMcpIssuer, resolveRemoteMcpJwksUrl, resolveRemoteMcpMode,
  type RemoteMcpConfig,
} from './remote-config.js';
import type { RemoteMcpIdentity } from './remote-grants.js';

export interface VerifiedRemoteMcpToken {
  identity: RemoteMcpIdentity;
  hasReadScope: boolean;
  hasWriteScope: boolean;
}

export function remoteMcpChallenge(config: RemoteMcpConfig, error?: 'invalid_token' | 'insufficient_scope'): string {
  const metadata = new URL(MCP_RESOURCE_METADATA_PATH, config.resource).href;
  return `Bearer resource_metadata="${metadata}", scope="${MCP_READ_SCOPE}"${error ? `, error="${error}"` : ''}`;
}

function extractClientId(payload: Record<string, unknown>, claims: readonly string[]): string | undefined {
  for (const claim of claims) {
    const value = payload[claim];
    if (typeof value === 'string' && value.trim() && value.length <= 1024) return value;
  }
  return undefined;
}

function extractScopes(rawScope: unknown): string[] {
  if (typeof rawScope === 'string') return rawScope.split(/\s+/).filter(Boolean);
  if (Array.isArray(rawScope)) return rawScope.filter((item): item is string => typeof item === 'string');
  return [];
}

function audienceMatches(aud: unknown, resource: string): boolean {
  if (typeof aud === 'string') return aud === resource;
  if (Array.isArray(aud)) return aud.includes(resource);
  return false;
}

async function introspectOpaqueToken(
  token: string,
  config: RemoteMcpConfig,
  issuer: string,
  clientIdClaims: readonly string[],
): Promise<VerifiedRemoteMcpToken | undefined> {
  if (!config.introspectionUrl) return undefined;
  const form = new URLSearchParams({ token, token_type_hint: 'access_token' });
  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json',
  };
  const secret = config.introspectionSecretEnv ? process.env[config.introspectionSecretEnv] : undefined;
  if (config.introspectionClientId && secret) {
    headers.Authorization = `Basic ${Buffer.from(`${config.introspectionClientId}:${secret}`).toString('base64')}`;
  } else if (config.introspectionClientId) {
    form.set('client_id', config.introspectionClientId);
  }
  try {
    const response = await undiciFetch(config.introspectionUrl, {
      method: 'POST',
      headers,
      body: form.toString(),
      redirect: 'error',
      signal: AbortSignal.timeout(3_000),
    });
    if (!response.ok) return undefined;
    const body = await response.json() as Record<string, unknown>;
    if (body.active !== true) return undefined;
    if (body.iss !== undefined && body.iss !== issuer) return undefined;
    if (!audienceMatches(body.aud, config.resource)) return undefined;
    if (typeof body.exp === 'number' && body.exp <= Math.floor(Date.now() / 1000)) return undefined;
    const subject = typeof body.sub === 'string' && body.sub.trim() && body.sub.length <= 1024 ? body.sub : undefined;
    const clientId = extractClientId(body, clientIdClaims);
    if (!subject || !clientId) return undefined;
    const scopes = extractScopes(body.scope);
    return {
      identity: { resource: config.resource, issuer, subject, clientId },
      hasReadScope: scopes.includes(MCP_READ_SCOPE),
      hasWriteScope: scopes.includes(MCP_WRITE_SCOPE),
    };
  } catch {
    return undefined;
  }
}

export function createRemoteMcpVerifier(config: RemoteMcpConfig) {
  const mode = resolveRemoteMcpMode(config);
  const issuer = resolveRemoteMcpIssuer(config);
  const jwksUrl = resolveRemoteMcpJwksUrl(config);
  const jwks = mode === 'external' && jwksUrl ? createRemoteJWKSet(new URL(jwksUrl), { timeoutDuration: 3000 }) : undefined;
  const acceptedTypes = new Set(config.acceptedTokenTypes ?? ['at+jwt']);
  const clientIdClaims = config.clientIdClaims ?? ['client_id'];
  const requireJti = config.requireJti ?? true;

  return async (authorization?: string): Promise<VerifiedRemoteMcpToken | undefined> => {
    const token = getMcpBearerToken(authorization);
    if (!token || token.length > 12_288) return undefined;

    if (mode === 'builtin') {
      return verifyBuiltinAccessToken(token, config.resource);
    }

    const looksLikeJwt = token.split('.').length === 3;
    if (!looksLikeJwt && config.introspectionUrl) {
      return introspectOpaqueToken(token, config, issuer, clientIdClaims);
    }
    if (!jwks) {
      return config.introspectionUrl ? introspectOpaqueToken(token, config, issuer, clientIdClaims) : undefined;
    }

    try {
      const header = decodeProtectedHeader(token);
      if (typeof header.typ !== 'string' || !acceptedTypes.has(header.typ)) {
        return undefined;
      }
      const requiredClaims = ['sub', 'exp', 'iat', ...(requireJti ? ['jti'] : [])];
      const { payload } = await jwtVerify(token, jwks, {
        issuer,
        audience: config.resource,
        algorithms: ['RS256', 'PS256', 'ES256', 'EdDSA'],
        requiredClaims,
      });
      const record = payload as Record<string, unknown>;
      const clientId = extractClientId(record, clientIdClaims);
      if (
        typeof payload.sub !== 'string' || !payload.sub || payload.sub.length > 1024
        || !clientId
        || typeof payload.iat !== 'number' || payload.iat > Date.now() / 1000 + 30
        || (requireJti && (typeof payload.jti !== 'string' || !payload.jti))
      ) {
        return undefined;
      }
      const scopes = extractScopes(payload.scope);
      return {
        identity: { resource: config.resource, issuer, subject: payload.sub, clientId },
        hasReadScope: scopes.includes(MCP_READ_SCOPE),
        hasWriteScope: scopes.includes(MCP_WRITE_SCOPE),
      };
    } catch {
      return undefined;
    }
  };
}
