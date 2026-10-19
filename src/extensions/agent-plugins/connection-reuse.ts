import { createHash } from 'node:crypto';
import type { Config } from '../../config/schema.js';
import type { PluginServer } from './validation.js';

export interface PluginOAuthReference { sourceServerId: string; credentialId: string; fingerprint: string }
export function connectionFingerprint(server: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify([server.url, server.oauth ?? null, server.auth ?? null, server.headers ?? null, server.xopcOAuthCredentialId])).digest('hex');
}
function settings(value: unknown): string {
  const object = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return JSON.stringify(Object.fromEntries(Object.entries(object).sort(([a], [b]) => a.localeCompare(b))));
}
export function matchingReusableConnection(target: PluginServer, source: Record<string, unknown>): boolean {
  return target.type !== 'stdio' && target.connectionAuth?.mode !== 'api-key' && source.enabled !== false && source.url === target.url
    && typeof source.xopcOAuthCredentialId === 'string' && /^mcp_draft_[a-f0-9]{32}$/.test(source.xopcOAuthCredentialId)
    && !source.auth && !Object.keys(source.headers as object ?? {}).some(key => key.toLowerCase() === 'authorization')
    && !Object.keys(target.headers ?? {}).some(key => key.toLowerCase() === 'authorization')
    && settings(source.oauth) === settings(target.oauth);
}
export function validPluginOAuthReference(reference: PluginOAuthReference, config: Config, target?: PluginServer): boolean {
  const source = config.mcp?.servers?.[reference.sourceServerId];
  return !!source && (!target || matchingReusableConnection(target, source)) && source.enabled !== false && source.xopcOAuthCredentialId === reference.credentialId && connectionFingerprint(source) === reference.fingerprint;
}
