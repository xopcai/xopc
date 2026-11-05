import { createHash, randomUUID } from 'node:crypto';
import Ajv2020 from 'ajv/dist/2020.js';
import { canonicalJson, locationRequestSchema, type TurnOrigin } from '@xopcai/endpoint-tools-protocol';

import { createLogger } from '../utils/logger.js';
import type { DeviceGrantAuditEvent } from '../storage/sqlite/device-grant-audit-repository.js';
import type { EndpointRegistry } from './registry.js';

export interface DeviceGrantLease { signal: AbortSignal; complete: () => void }

interface DeviceGrant {
  id: string; conversationId: string; requestorPrincipalId: string; targetEndpointId: string; targetPrincipalId: string;
  arguments: Record<string, unknown>; toolRevision: string; connectionId: string; toolName: string; argumentsDigest: string; expiresAt: number; state: 'ready' | 'running';
  controller: AbortController;
}
const grantLog = createLogger('DeviceGrants');
const digest = (args: Record<string, unknown>) => createHash('sha256').update(canonicalJson(args)).digest('hex');

/** Deliberately non-durable: restart, expiry, disconnect or revoke invalidates single-call consent. */
export class DeviceGrantService {
  private readonly grants = new Map<string, DeviceGrant>();
  constructor(private readonly registry: EndpointRegistry, private readonly now = Date.now, private readonly audit?: (event: DeviceGrantAuditEvent) => void) {}
  issue(input: { conversationId: string; requestorPrincipalId: string; targetEndpointId: string; toolName: string; arguments: Record<string, unknown> }) {
    this.prune();
    if (this.grants.size >= 100) throw new Error('Too many outstanding device authorizations');
    const target = this.registry.get(input.targetEndpointId);
    const tool = target && this.registry.getTool(target.endpointId, input.toolName);
    if (!target || !tool || tool.descriptor.requiresForeground && target.availability !== 'foreground'
      || !this.registry.list().some(endpoint => endpoint.principalId === input.requestorPrincipalId)) throw new Error('Device is offline');
    const location = /^(mobile|web|desktop)\.device\.get_location$/.test(input.toolName);
    if (!location && !tool.provider) throw new Error('Unsupported device authorization');
    const args = location ? locationRequestSchema.parse(input.arguments) : structuredClone(input.arguments);
    if (Buffer.byteLength(canonicalJson(args)) > 32 * 1024 || !new Ajv2020({ strict: false, validateFormats: false }).compile(tool.descriptor.inputSchema)(args)) {
      throw new Error('Invalid device authorization arguments');
    }
    for (const grant of this.grants.values()) if (grant.conversationId === input.conversationId
      && grant.requestorPrincipalId === input.requestorPrincipalId && grant.toolName === input.toolName) this.revoke(grant.id);
    const grant: DeviceGrant = { conversationId: input.conversationId, requestorPrincipalId: input.requestorPrincipalId, targetEndpointId: input.targetEndpointId, toolName: input.toolName, arguments: args, id: randomUUID(), targetPrincipalId: target.principalId,
      connectionId: target.connectionId, toolRevision: tool.revision, argumentsDigest: digest(args), expiresAt: this.now() + 60_000, state: 'ready', controller: new AbortController() };
    this.audit?.({ ...grant, event: 'issued' });
    this.grants.set(grant.id, grant);
    const timer = setTimeout(() => this.revoke(grant.id, 'expired'), 60_000); timer.unref();
    grant.controller.signal.addEventListener('abort', () => clearTimeout(timer), { once: true });
    return this.summary(grant);
  }
  private requestor(origin: TurnOrigin) { return origin.type === 'endpoint' ? this.registry.get(origin.endpointId)?.principalId : undefined; }
  candidates(conversationId: string, origin: TurnOrigin) {
    this.prune(); const principal = this.requestor(origin);
    return [...this.grants.values()].filter(grant => grant.state === 'ready' && grant.conversationId === conversationId && grant.requestorPrincipalId === principal);
  }
  find(conversationId: string, origin: TurnOrigin, endpointId: string, toolName: string) {
    return this.candidates(conversationId, origin).find(grant => grant.targetEndpointId === endpointId && grant.toolName === toolName);
  }
  reserve(id: string, args: Record<string, unknown>): DeviceGrantLease {
    this.prune(); const grant = this.grants.get(id);
    if (!grant || grant.state !== 'ready' || grant.argumentsDigest !== digest(args)) throw new Error('Device authorization expired, consumed or outside its scope');
    this.audit?.({ ...grant, event: 'reserved' });
    grant.state = 'running';
    return { signal: grant.controller.signal, complete: () => this.revoke(id, 'consumed') };
  }
  list() { this.prune(); return [...this.grants.values()].map(grant => this.summary(grant)); }
  revoke(id: string, reason: 'consumed' | 'revoked' | 'expired' = 'revoked') { const grant = this.grants.get(id); if (!grant) return false;
    this.grants.delete(id); grant.controller.abort();
    try { this.audit?.({ ...grant, event: reason }); } catch (err) { grantLog.error({ err, grantId: id }, 'Device grant invalidated but audit write failed'); }
    return true; }
  revokeEndpoint(endpointId: string, principalId = this.registry.get(endpointId)?.principalId) { for (const grant of this.grants.values()) if (grant.targetEndpointId === endpointId
    || grant.requestorPrincipalId === principalId) this.revoke(grant.id); }
  close() { for (const id of this.grants.keys()) this.revoke(id); }
  private prune() { for (const grant of this.grants.values()) if (grant.expiresAt <= this.now()
    || this.registry.get(grant.targetEndpointId)?.connectionId !== grant.connectionId
    || this.registry.getTool(grant.targetEndpointId, grant.toolName)?.revision !== grant.toolRevision
    || !this.registry.list().some(endpoint => endpoint.principalId === grant.requestorPrincipalId)) this.revoke(grant.id, grant.expiresAt <= this.now() ? 'expired' : 'revoked'); }
  private summary(grant: DeviceGrant) { const { controller: _controller, argumentsDigest: _digest, ...summary } = grant; return summary; }
}
