import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';

import { canonicalJson } from '@xopcai/endpoint-tools-protocol';
import { z } from 'zod';

import { getAutomation } from '../automations/storage/automation-repository.js';
import type { Automation } from '../automations/domain/types.js';
import { getEndpointPrincipal } from '../storage/sqlite/endpoint-principal-repository.js';
import { isXopcDatabaseOpen } from '../storage/sqlite/connection.js';
import { DurableState } from '../storage/sqlite/durable-state.js';
import type { EndpointConnectionSnapshot, EndpointRegistry } from './registry.js';

const identifier = z.string().trim().min(1).max(200);
const subjectSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('channel'), channel: identifier, accountId: identifier, chatId: identifier,
    senderId: identifier, threadId: identifier.optional() }),
  z.strictObject({ kind: z.literal('automation'), automationId: identifier }),
]);
export const deviceDelegationRequestSchema = z.strictObject({
  subject: subjectSchema, endpointId: identifier, toolName: z.string().min(1).max(256),
  arguments: z.record(z.string(), z.unknown()), expiresAt: z.number().int().positive(),
});
export type DeviceDelegationSubject = z.infer<typeof subjectSchema>;
type Request = z.infer<typeof deviceDelegationRequestSchema>;
type Grant = {
  id: string;
  subject: DeviceDelegationSubject;
  endpointId: string;
  principalId: string;
  toolName: string;
  providerDigest: string;
  argumentsDigest: string;
  expiresAt: number;
  issuedAt: number;
  automationContract?: string;
};
type RunAuthority = { grantId: string; subject: DeviceDelegationSubject; conversationId: string; runId: string;
  expiresAt: number; connectionId?: string };

const grants = new DurableState<Grant>('device.delegations');
const runs = new DurableState<RunAuthority>('device.delegated-runs');
const scope = new AsyncLocalStorage<RunAuthority>();
const digest = (input: unknown) => createHash('sha256').update(canonicalJson(input)).digest('hex');
const key = (subject: DeviceDelegationSubject) => canonicalJson(subject);
const runKey = (run: RunAuthority) => JSON.stringify([run.conversationId, run.runId]);
const MAX_TTL = 30 * 24 * 60 * 60_000;

function automationContract(automation: Automation | null): string | undefined {
  if (!automation?.enabled || automation.action.kind !== 'agent') return;
  return digest(JSON.parse(JSON.stringify({ createdAtMs: automation.createdAtMs, action: automation.action, safety: automation.safety })));
}

export function issueDeviceDelegation(request: Request, registry: EndpointRegistry): Grant {
  const now = Date.now();
  if (request.expiresAt <= now || request.expiresAt > now + MAX_TTL) throw new Error('Delegation expiry must be within 30 days');
  const endpoint = registry.get(request.endpointId), tool = registry.getTool(request.endpointId, request.toolName);
  if (!endpoint || !tool?.provider || tool.provider.artifactInput || tool.descriptor.sensitivity !== 'public') throw new Error('Select an admitted public Provider tool');
  const subjectKey = key(request.subject);
  const existing = grants.entries();
  for (const [id, grant] of existing) if (grant.expiresAt <= now) grants.delete(id);
  if (!grants.get(subjectKey) && grants.values(256).length >= 256) throw new Error('Device delegation capacity reached');
  const automation = request.subject.kind === 'automation' ? getAutomation(request.subject.automationId) : null;
  const contract = automationContract(automation);
  if (request.subject.kind === 'automation' && !contract) throw new Error('Automation must be enabled and use an agent action');
  if (automation && tool.descriptor.effect !== 'read' && automation.safety?.mode !== 'auto_apply') {
    throw new Error('Automation policy does not permit delegated mutations');
  }
  const grant: Grant = { id: randomUUID(), subject: request.subject, endpointId: endpoint.endpointId, principalId: endpoint.principalId,
    toolName: request.toolName, providerDigest: tool.provider.digest, argumentsDigest: digest(request.arguments), expiresAt: request.expiresAt, issuedAt: now,
    ...(contract ? { automationContract: contract } : {}) };
  grants.set(subjectKey, grant);
  return grant;
}

export function listDeviceDelegations() { return grants.values(256).filter(grant => grant.expiresAt > Date.now()); }

export function revokeDeviceDelegation(id: string): void {
  const match = grants.entries().find(([, grant]) => grant.id === id);
  if (match) grants.delete(match[0]);
}

/** Call only from the verified channel or automation dispatcher, with host-owned run identity. */
export function withDeviceDelegation<T>(input: { subject: DeviceDelegationSubject; acceptedAt: number; automation?: Automation } | undefined,
  conversationId: string, runId: string, execute: () => T): T {
  if (!input || !isXopcDatabaseOpen()) return scope.exit(execute);
  const { subject } = input;
  const grant = grants.get(key(subject)), now = Date.now();
  if (!grant || grant.expiresAt <= now || grant.issuedAt > input.acceptedAt
    || subject.kind === 'automation' && (!input.automation || automationContract(input.automation) !== grant.automationContract)) return scope.exit(execute);
  const authority: RunAuthority = { subject, grantId: grant.id, conversationId, runId, expiresAt: Math.min(grant.expiresAt, now + 60 * 60_000) };
  const id = runKey(authority);
  const existing = runs.get(id);
  if (existing) return existing.grantId === grant.id && key(existing.subject) === key(subject) ? scope.run(existing, execute) : scope.exit(execute);
  const all = runs.entries();
  for (const [recordId, record] of all) if (record.expiresAt <= now) runs.delete(recordId);
  if (runs.values(1024).length >= 1024) return scope.exit(execute);
  runs.set(id, authority);
  return scope.run(authority, execute);
}

export function resolveDeviceDelegation(conversationId: string, runId: string | undefined, registry: EndpointRegistry):
  { grant?: Grant; endpoint?: EndpointConnectionSnapshot } | undefined {
  const authority = scope.getStore();
  if (!authority || authority.conversationId !== conversationId || authority.runId !== runId) return;
  if (!isXopcDatabaseOpen()) return {};
  const now = Date.now(), grant = grants.get(key(authority.subject));
  if (!grant || grant.id !== authority.grantId || grant.expiresAt <= now || authority.expiresAt <= now) return {};
  if (authority.subject.kind === 'automation' && automationContract(getAutomation(authority.subject.automationId)) !== grant.automationContract) return {};
  const endpoint = registry.get(grant.endpointId), tool = registry.getTool(grant.endpointId, grant.toolName);
  const principal = getEndpointPrincipal(grant.principalId);
  if (!principal || principal.revokedAt !== undefined || endpoint?.principalId !== grant.principalId
    || tool?.provider?.digest !== grant.providerDigest || authority.connectionId && authority.connectionId !== endpoint.connectionId) return {};
  if (!authority.connectionId) {
    const pinned = { ...authority, connectionId: endpoint.connectionId };
    runs.set(runKey(authority), pinned);
    authority.connectionId = pinned.connectionId;
  }
  return { grant, endpoint };
}

export function deviceDelegationAllowsArguments(grant: Grant, args: Record<string, unknown>): boolean {
  return grant.argumentsDigest === digest(args);
}
