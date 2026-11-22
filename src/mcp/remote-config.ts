import { z } from 'zod';

export const REMOTE_MCP_PATH = '/mcp';
export const MCP_RESOURCE_METADATA_PATH = '/.well-known/oauth-protected-resource/mcp';
export const MCP_ROOT_RESOURCE_METADATA_PATH = '/.well-known/oauth-protected-resource';
export const MCP_OAUTH_AS_METADATA_PATH = '/.well-known/oauth-authorization-server';
export const MCP_OAUTH_BASE_PATH = '/mcp/oauth';
export const MCP_READ_SCOPE = 'mcp.read';
export const MCP_WRITE_SCOPE = 'mcp.write';

const oauthUrl = z.string().refine(value => {
  const url = URL.parse(value);
  if (!url) return false;
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  return !url.username && !url.password && !value.includes('?') && !value.includes('#')
    && (url.protocol === 'https:' || (url.protocol === 'http:' && local));
}, 'Use HTTPS, or HTTP on loopback, without userinfo, query or fragment');

const allowedOriginUrl = z.string().refine(value => {
  const url = URL.parse(value);
  if (!url) return false;
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  return url.origin === value && (url.protocol === 'https:' || (url.protocol === 'http:' && local));
}, 'Use a canonical origin (https://... or loopback http://...) without path, query or fragment');

export const RemoteMcpConfigSchema = z.strictObject({
  mode: z.enum(['external', 'builtin']).optional(),
  resource: oauthUrl.refine(value => {
    const url = URL.parse(value);
    return url?.pathname === REMOTE_MCP_PATH && url.href === value;
  }, 'Use the canonical Gateway URL ending in /mcp'),
  issuer: oauthUrl.optional(),
  jwksUrl: oauthUrl.optional(),
  allowedOrigins: z.array(allowedOriginUrl).max(32).optional(),
  acceptedTokenTypes: z.array(z.string().trim().min(1).max(64)).min(1).max(8).optional(),
  clientIdClaims: z.array(z.string().trim().min(1).max(64)).min(1).max(8).optional(),
  requireJti: z.boolean().optional(),
  introspectionUrl: oauthUrl.optional(),
  introspectionClientId: z.string().trim().min(1).max(256).optional(),
  introspectionSecretEnv: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).optional(),
  rateLimitMax: z.number().int().min(1).max(10_000).optional(),
  rateLimitWindowMs: z.number().int().min(1_000).max(3_600_000).optional(),
}).superRefine((value, ctx) => {
  const effectiveMode = value.mode ?? (value.issuer && value.jwksUrl ? 'external' : 'builtin');
  if (effectiveMode === 'external') {
    if (!value.issuer) {
      ctx.addIssue({ code: 'custom', path: ['issuer'], message: 'issuer is required in external OAuth mode' });
    }
    if (!value.jwksUrl && !value.introspectionUrl) {
      ctx.addIssue({ code: 'custom', path: ['jwksUrl'], message: 'jwksUrl or introspectionUrl is required in external OAuth mode' });
    }
  }
});

export type RemoteMcpConfig = z.infer<typeof RemoteMcpConfigSchema>;

export function resolveRemoteMcpMode(config: RemoteMcpConfig): 'external' | 'builtin' {
  return config.mode ?? (config.issuer && (config.jwksUrl || config.introspectionUrl) ? 'external' : 'builtin');
}

export function resolveRemoteMcpIssuer(config: RemoteMcpConfig): string {
  if (resolveRemoteMcpMode(config) === 'builtin') {
    return new URL(config.resource).origin;
  }
  return config.issuer!;
}

export function resolveRemoteMcpJwksUrl(config: RemoteMcpConfig): string | undefined {
  if (resolveRemoteMcpMode(config) === 'builtin') {
    return new URL(`${MCP_OAUTH_BASE_PATH}/jwks`, config.resource).href;
  }
  return config.jwksUrl;
}
