import { z } from 'zod';

const id = z.string().min(1).max(64).regex(/^[a-z][a-z0-9-]*$/);
export const setupCommandSchema = z.strictObject({
  command: z.string().min(1), args: z.array(z.string()).max(100).default([]),
  env: z.record(z.string(), z.string()).default({}), cwd: z.string().optional(),
});
const guidance = {
  id, title: z.string().min(1).max(100),
  instructions: z.array(z.string().min(1).max(1000)).max(12).default([]),
  helpUrl: z.string().url().optional(),
};
export const pluginAuthorizationSchema = z.array(z.strictObject({
  id, title: z.string().min(1).max(100), description: z.string().max(1000).optional(),
  servers: z.array(z.string().min(1)).min(1).max(20),
  methods: z.array(z.discriminatedUnion('type', [
    z.strictObject({ ...guidance, type: z.literal('oauth'), server: z.string().min(1) }),
    z.strictObject({ ...guidance, type: z.literal('form'), fields: z.array(z.string().min(1)).min(1).max(20) }),
    z.strictObject({ ...guidance, type: z.literal('cli'), fields: z.array(z.string().min(1)).max(20).default([]), login: setupCommandSchema, check: setupCommandSchema, timeoutSeconds: z.number().int().min(10).max(900).default(300) }),
  ])).min(1).max(6),
})).max(20);
export type PluginAuthorization = z.infer<typeof pluginAuthorizationSchema>[number];
export type SetupCommand = z.infer<typeof setupCommandSchema>;
export function pluginAuthorizations(manifest: { extensions?: Record<string, unknown> }): PluginAuthorization[] {
  const extension = manifest.extensions?.['ai.xopc'] as { setup?: { authorizations?: unknown } } | undefined;
  const declarations = pluginAuthorizationSchema.parse(extension?.setup?.authorizations ?? []);
  for (const account of declarations) for (const method of account.methods) if (method.helpUrl) safeAuthorizationUrl(method.helpUrl);
  return declarations;
}
export function safeAuthorizationUrl(value: string): string {
  const url = new URL(value);
  if (url.username || url.password || !(url.protocol === 'https:' || url.protocol === 'http:' && ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname))) throw new Error('Authorization requires an HTTPS or loopback URL');
  return url.href;
}

export const pluginPermissionIssueSchema = z.strictObject({
  id, title: z.string().min(1).max(100),
  scopes: z.array(z.string().min(1).max(200).regex(/^[a-zA-Z0-9_.:-]+$/)).max(30).default([]),
  instructions: z.array(z.string().min(1).max(1000)).max(6).default([]),
  method: id.optional(), helpUrl: z.string().url().optional(),
});
export type PluginPermissionIssue = z.infer<typeof pluginPermissionIssueSchema>;
export function parsePluginAuthorizationCheck(output: string, methodIds: string[]) {
  const result = z.object({ authenticated: z.boolean(), expiresAt: z.number().finite().optional(), issues: z.array(pluginPermissionIssueSchema).max(20).default([]) }).parse(JSON.parse(output.trim().split('\n').at(-1)!));
  for (const issue of result.issues) {
    if (issue.method && !methodIds.includes(issue.method)) throw new Error('Unknown permission recovery method');
    if (issue.helpUrl) safeAuthorizationUrl(issue.helpUrl);
  }
  return result;
}
