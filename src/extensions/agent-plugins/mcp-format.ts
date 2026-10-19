import { z } from 'zod';

const oauthClient = z.discriminatedUnion('mode', [
  z.strictObject({ mode: z.literal('provided'), clientId: z.string().min(1), tokenEndpointAuthMethod: z.literal('none').optional() }),
  z.strictObject({ mode: z.enum(['dcr', 'cimd']) }),
]);
const scope = z.string().trim().min(1);
const authSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.enum(['oauth', 'mixed']), client: oauthClient.optional(), baseScopes: z.array(scope).optional(), defaultScopes: z.array(scope).optional() }),
  z.strictObject({ type: z.literal('none') }),
  z.strictObject({ type: z.literal('api_key'), headerScheme: z.enum(['bearer', 'basic', 'custom_header']), headerName: z.string().optional() }),
]);

/** Only map authentication settings that native pi can represent without semantic loss. */
export function normalizePluginMcpServer(input: unknown, legacy: boolean, warn: (message: string) => void): unknown {
  const value = { ...z.record(z.string(), z.unknown()).parse(input) };
  const extensions = value.extensions;
  if (extensions !== undefined) {
    const ext = z.record(z.string(), z.unknown()).parse(extensions);
    for (const key of Object.keys(ext)) if (key !== 'com.openai') warn(`Unrecognized MCP extension: ${key}`);
    const openai = ext['com.openai'] === undefined ? {} : z.record(z.string(), z.unknown()).parse(ext['com.openai']);
    for (const key of Object.keys(openai)) if (key !== 'auth') warn(`Unrecognized OpenAI MCP declaration: ${key}`);
    if (openai.auth !== undefined) {
      const auth = authSchema.parse(openai.auth);
      if (auth.type === 'oauth' || auth.type === 'mixed') {
        if (auth.baseScopes?.length && auth.defaultScopes === undefined) throw new Error('OAuth base scopes with discovered defaults require an adapter');
        value.oauth = {
          ...(auth.client?.mode === 'provided' ? { clientId: auth.client.clientId } : auth.client ? { clientRegistration: auth.client.mode } : {}),
          ...(auth.defaultScopes !== undefined ? { scope: [...new Set([...(auth.baseScopes ?? []), ...auth.defaultScopes])].join(' ') } : {}),
        };
        value.connectionAuth = { mode: 'oauth' };
      } else if (auth.type === 'api_key') {
        if (auth.headerScheme === 'custom_header' && !auth.headerName || auth.headerScheme !== 'custom_header' && auth.headerName) throw new Error('Invalid API key header declaration');
        value.connectionAuth = { mode: 'api-key', headerName: auth.headerName ?? 'Authorization', prefix: auth.headerScheme === 'bearer' ? 'Bearer ' : auth.headerScheme === 'basic' ? 'Basic ' : '' };
      } else value.connectionAuth = { mode: 'none' };
    }
    delete value.extensions;
  }
  if (legacy) {
    const allowed = new Set(['type', 'command', 'args', 'env', 'cwd', 'url', 'headers', 'oauth_resource', 'oauth', 'connectionAuth']);
    for (const key of Object.keys(value)) if (!allowed.has(key)) { warn(`Unsupported MCP field: ${key}`); delete value[key]; }
    if (value.oauth_resource !== undefined && value.oauth_resource !== value.url) throw new Error('A distinct OAuth resource requires an adapter');
    delete value.oauth_resource;
    value.type = value.type === 'http' ? 'streamable-http' : value.type ?? (value.command ? 'stdio' : 'streamable-http');
    if (typeof value.command === 'string') value.command = value.command.replace(/^\$\{(?:CLAUDE_)?PLUGIN_ROOT\}\//, './');
    if (typeof value.cwd === 'string') value.cwd = value.cwd.replace(/^\$\{CLAUDE_PLUGIN_(ROOT|DATA)\}/, '${PLUGIN_$1}');
  }
  return value;
}
