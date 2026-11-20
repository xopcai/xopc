import { z } from 'zod';

export const REMOTE_MCP_PATH = '/mcp';
export const MCP_RESOURCE_METADATA_PATH = '/.well-known/oauth-protected-resource/mcp';
export const MCP_READ_SCOPE = 'mcp.read';
export const MCP_WRITE_SCOPE = 'mcp.write';

const oauthUrl = z.string().refine(value => {
  const url = URL.parse(value);
  if (!url) return false;
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  return !url.username && !url.password && !value.includes('?') && !value.includes('#')
    && (url.protocol === 'https:' || (url.protocol === 'http:' && local));
}, 'Use HTTPS, or HTTP on loopback, without userinfo, query or fragment');

export const RemoteMcpConfigSchema = z.strictObject({
  resource: oauthUrl.refine(value => {
    const url = URL.parse(value);
    return url?.pathname === REMOTE_MCP_PATH && url.href === value;
  }, 'Use the canonical Gateway URL ending in /mcp'),
  issuer: oauthUrl,
  jwksUrl: oauthUrl,
});

export type RemoteMcpConfig = z.infer<typeof RemoteMcpConfigSchema>;
