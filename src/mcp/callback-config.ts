import { z } from 'zod';

const httpsCallbackUrl = z.url().refine(value => {
  const url = new URL(value);
  return url.protocol === 'https:' && !url.username && !url.password && !url.hash && !url.search;
}, 'Use an HTTPS callback URL without credentials, query or fragment');

export const McpCallbackConfigSchema = z.strictObject({
  url: httpsCallbackUrl,
  secretEnv: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
});

export const McpConnectionCallbackSchema = z.strictObject({
  url: httpsCallbackUrl,
  secret: z.string().min(16).max(256).optional(),
  secretEnv: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).optional(),
}).refine(value => Boolean(value.secret || value.secretEnv), 'Provide a callback secret or secretEnv');

export type McpCallbackConfig = z.infer<typeof McpCallbackConfigSchema>;
export type McpConnectionCallback = z.infer<typeof McpConnectionCallbackSchema>;

export function resolveMcpCallbackSecret(callback: McpCallbackConfig | McpConnectionCallback | undefined): string | undefined {
  if (!callback) return undefined;
  if ('secret' in callback && callback.secret) return callback.secret;
  return callback.secretEnv ? process.env[callback.secretEnv] : undefined;
}
