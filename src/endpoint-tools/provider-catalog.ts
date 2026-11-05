import { createHash } from 'node:crypto';

import Ajv2020 from 'ajv/dist/2020.js';
import {
  assertProviderSchemaBudget, canonicalJson, providerCatalogSchema, providerStateSchema, providerEndpointDescriptor,
  type CapabilityProvider, type ProviderCatalog, type ProviderState,
} from '@xopcai/endpoint-tools-protocol';

import { DurableState } from '../storage/sqlite/durable-state.js';
import { runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';
import type { EndpointRegistry, RegisteredEndpointTool } from './registry.js';

export interface ProviderRecord {
  principalId: string;
  provider: CapabilityProvider;
  digest: string;
  admittedDigest?: string;
}

export interface ProviderCatalogStore {
  get(key: string): ProviderRecord | undefined;
  set(key: string, value: ProviderRecord): void;
  entries(): Array<[string, ProviderRecord]>;
  setMany(records: Array<[string, ProviderRecord]>): void;
}

class SqliteProviderCatalogStore extends DurableState<ProviderRecord> implements ProviderCatalogStore {
  constructor() { super('device.providers'); }
  setMany(records: Array<[string, ProviderRecord]>) {
    runSqliteWriteTransaction(() => { for (const [key, value] of records) this.set(key, value); });
  }
}

const keyOf = (principalId: string, localId: string) => JSON.stringify([principalId, localId]);
const hash = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex');

/** Device claims are retained offline; execution requires a live connection and exact owner admission. */
export class EndpointProviderCatalog {
  private readonly publicationBudget = new Map<string, { start: number; count: number }>();
  private readonly live = new Map<string, { principalId: string; endpointId: string; connectionId: string; revision: number; providerIds: string[] }>();
  private readonly owners = new Map<string, string>();
  private readonly states = new Map<string, ProviderState & { expiresAt: number }>();
  private enabled = true;

  constructor(private readonly registry: EndpointRegistry,
    private readonly store: ProviderCatalogStore = new SqliteProviderCatalogStore(),
    private readonly now = Date.now) {}

  setEnabled(enabled: boolean): void {
    if (enabled === this.enabled) return;
    this.enabled = enabled;
    for (const endpointId of this.live.keys()) this.sync(endpointId);
  }

  replace(endpointId: string, connectionId: string, raw: ProviderCatalog): void {
    const endpoint = this.requireConnection(endpointId, connectionId);
    const now = this.now();
    for (const [id, window] of this.publicationBudget) if (window.start + 10_000 <= now) this.publicationBudget.delete(id);
    const budget = this.publicationBudget.get(endpoint.principalId) ?? { start: now, count: 0 };
    if (++budget.count > 8) throw new Error('PROVIDER_CATALOG_RATE_LIMITED');
    this.publicationBudget.set(endpoint.principalId, budget);
    const catalog = providerCatalogSchema.parse(raw);
    const previous = this.live.get(endpointId);
    if (previous?.connectionId === connectionId && catalog.revision <= previous.revision) throw new Error('PROVIDER_CATALOG_REVISION_CONFLICT');
    const checkedSchemas = new Set<string>();
    const compile = (schema: Record<string, unknown>) => {
      const digest = hash(schema);
      if (checkedSchemas.has(digest)) return;
      new Ajv2020({ strict: false, validateFormats: false, inlineRefs: false }).compile(schema);
      checkedSchemas.add(digest);
    };
    const records = catalog.providers.map(provider => {
      const owner = this.live.get(this.owners.get(keyOf(endpoint.principalId, provider.localId)) ?? '');
      if (owner && owner.endpointId !== endpointId && this.registry.isCurrentConnection(owner.endpointId, owner.connectionId)) {
        throw new Error('PROVIDER_CONNECTION_CONFLICT');
      }
      for (const tool of provider.tools) {
        assertProviderSchemaBudget(tool.inputSchema);
        if (tool.outputSchema) assertProviderSchemaBudget(tool.outputSchema);
        const descriptor = providerEndpointDescriptor(provider.localId, tool);
        compile(descriptor.inputSchema); compile(descriptor.outputSchema);
      }
      const key = keyOf(endpoint.principalId, provider.localId), existing = this.store.get(key);
      return { principalId: endpoint.principalId, provider, digest: hash(provider),
        ...(existing?.admittedDigest ? { admittedDigest: existing.admittedDigest } : {}) };
    });
    // Validation finishes before either the published snapshot or executable tools change.
    this.store.setMany(records.map(record => [keyOf(record.principalId, record.provider.localId), record]));
    for (const localId of previous?.providerIds ?? []) {
      const key = keyOf(endpoint.principalId, localId);
      if (this.owners.get(key) === endpointId) this.owners.delete(key);
      this.states.delete(key);
    }
    this.live.set(endpointId, { principalId: endpoint.principalId, endpointId, connectionId, revision: catalog.revision, providerIds: records.map(r => r.provider.localId) });
    for (const record of records) {
      const key = keyOf(endpoint.principalId, record.provider.localId);
      this.owners.set(key, endpointId);
      this.states.delete(key);
    }
    this.sync(endpointId);
  }

  list(principalId?: string) {
    return this.store.entries().map(([, record]) => record).filter(record => !principalId || record.principalId === principalId).map(record => {
      const live = this.live.get(this.owners.get(keyOf(record.principalId, record.provider.localId)) ?? '');
      const connected = live && this.registry.isCurrentConnection(live.endpointId, live.connectionId) && live.providerIds.includes(record.provider.localId);
      const state = this.states.get(keyOf(record.principalId, record.provider.localId));
      return { ...record, admitted: record.admittedDigest === record.digest,
        ...(connected ? { endpointId: live.endpointId, connectionId: live.connectionId } : {}),
        status: !connected ? 'offline' : !this.enabled ? 'unavailable' : record.admittedDigest !== record.digest ? 'authorization_required'
          : state && state.expiresAt > this.now() ? state.reason : 'unavailable' };
    });
  }

  admit(principalId: string, localId: string, expectedDigest: string, allowed: boolean): void {
    const key = keyOf(principalId, localId), record = this.store.get(key);
    if (!record || record.digest !== expectedDigest) throw new Error('PROVIDER_CONTRACT_CHANGED');
    this.store.set(key, { ...record, admittedDigest: allowed ? expectedDigest : undefined });
    const endpointId = this.owners.get(key);
    if (endpointId) this.sync(endpointId);
  }

  reportState(endpointId: string, connectionId: string, raw: ProviderState): void {
    const endpoint = this.requireConnection(endpointId, connectionId), state = providerStateSchema.parse(raw);
    const live = this.live.get(endpointId);
    if (live?.connectionId !== connectionId || live.revision !== state.catalogRevision || !live.providerIds.includes(state.localId)) throw new Error('PROVIDER_NOT_REGISTERED');
    const key = keyOf(endpoint.principalId, state.localId), previous = this.states.get(key);
    if (previous && state.sequence <= previous.sequence) throw new Error('PROVIDER_STATE_SEQUENCE_CONFLICT');
    this.states.set(key, { ...state, expiresAt: this.now() + state.validForMs });
  }

  disconnect(endpointId: string, connectionId: string): void {
    const live = this.live.get(endpointId);
    if (!live || live.connectionId !== connectionId) return;
    this.live.delete(endpointId);
    for (const localId of live.providerIds) {
      const key = keyOf(live.principalId, localId);
      if (this.owners.get(key) === endpointId) { this.owners.delete(key); this.states.delete(key); }
    }
  }

  assertExecutable(endpointId: string, toolName: string): void {
    const tool = this.registry.getTool(endpointId, toolName);
    if (!tool?.provider) return;
    const key = keyOf(tool.provider.principalId, tool.provider.localId), record = this.store.get(key);
    const live = this.live.get(endpointId);
    if (!record || record.admittedDigest !== record.digest || this.owners.get(key) !== endpointId
      || live?.connectionId !== this.registry.get(endpointId)?.connectionId
      || !this.isReady(tool.provider)) throw new Error('PROVIDER_UNAVAILABLE');
  }

  isReady(provider: NonNullable<RegisteredEndpointTool['provider']>): boolean {
    const state = this.states.get(keyOf(provider.principalId, provider.localId));
    return this.enabled && state?.reason === 'ready' && state.expiresAt > this.now();
  }

  private sync(endpointId: string): void {
    const live = this.live.get(endpointId);
    if (!live || !this.registry.isCurrentConnection(live.endpointId, live.connectionId)) return;
    if (!this.enabled) {
      this.registry.replaceProviderTools(live.endpointId, live.connectionId, []);
      return;
    }
    const principalId = live.principalId;
    const tools: RegisteredEndpointTool[] = [];
    for (const localId of live.providerIds) {
      const record = this.store.get(keyOf(principalId, localId));
      if (!record || record.digest !== record.admittedDigest) continue;
      for (const tool of record.provider.tools) {
        const descriptor = providerEndpointDescriptor(localId, tool);
        tools.push({ descriptor, revision: hash(descriptor), provider: { principalId, localId, name: tool.name,
          summary: record.provider.summary, instructions: record.provider.instructions, digest: record.digest,
          durableOperations: record.provider.durableOperations, artifactInput: tool.artifactInput,
          gatewayFormInput: record.provider.gatewayFormInput, resourceId: tool.resourceId } });
      }
    }
    this.registry.replaceProviderTools(live.endpointId, live.connectionId, tools);
  }

  private requireConnection(endpointId: string, connectionId: string) {
    const endpoint = this.registry.get(endpointId);
    if (!endpoint || endpoint.connectionId !== connectionId) throw new Error('Endpoint connection is no longer active');
    return endpoint;
  }
}
