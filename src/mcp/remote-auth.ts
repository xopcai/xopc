import { createRemoteJWKSet, jwtVerify } from 'jose';

import { getMcpBearerToken } from './connection-grants.js';
import { MCP_READ_SCOPE, MCP_WRITE_SCOPE, MCP_RESOURCE_METADATA_PATH, type RemoteMcpConfig } from './remote-config.js';
import type { RemoteMcpIdentity } from './remote-grants.js';

export function remoteMcpChallenge(config: RemoteMcpConfig, error?: 'invalid_token' | 'insufficient_scope'): string {
  const metadata = new URL(MCP_RESOURCE_METADATA_PATH, config.resource).href;
  return `Bearer resource_metadata="${metadata}", scope="${MCP_READ_SCOPE}"${error ? `, error="${error}"` : ''}`;
}

export function createRemoteMcpVerifier(config: RemoteMcpConfig) {
  const jwks = createRemoteJWKSet(new URL(config.jwksUrl), { timeoutDuration: 3000 });
  return async (authorization?: string): Promise<{ identity: RemoteMcpIdentity; hasReadScope: boolean; hasWriteScope: boolean } | undefined> => {
    const token = getMcpBearerToken(authorization);
    if (!token || token.length > 12_288) return undefined;
    try {
      const { payload } = await jwtVerify(token, jwks, {
        issuer: config.issuer, audience: config.resource, typ: 'at+jwt',
        algorithms: ['RS256', 'PS256', 'ES256', 'EdDSA'],
        requiredClaims: ['sub', 'client_id', 'exp', 'iat', 'jti'],
      });
      if (typeof payload.sub !== 'string' || !payload.sub || payload.sub.length > 1024
        || typeof payload.client_id !== 'string' || !payload.client_id || payload.client_id.length > 1024
        || typeof payload.iat !== 'number' || payload.iat > Date.now() / 1000 + 30
        || typeof payload.jti !== 'string' || !payload.jti) return undefined;
      const scopes = typeof payload.scope === 'string' ? payload.scope.split(' ') : [];
      return {
        identity: { resource: config.resource, issuer: config.issuer, subject: payload.sub, clientId: payload.client_id },
        hasReadScope: scopes.includes(MCP_READ_SCOPE), hasWriteScope: scopes.includes(MCP_WRITE_SCOPE),
      };
    } catch {
      return undefined;
    }
  };
}
