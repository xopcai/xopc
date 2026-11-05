import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';
import { deviceStateDescriptor, type CapabilityProvider } from '@xopcai/endpoint-tools-protocol';

import { EndpointProviderCatalog, type ProviderRecord } from '../provider-catalog.js';
import { EndpointRegistry } from '../registry.js';

const provider: CapabilityProvider = { localId: 'documents', title: 'Documents', summary: 'Private documents', tools: [{
  name: 'Search-Docs', title: 'Search documents', description: 'Search selected documents', inputSchema: { type: 'object' },
  outputSchema: { type: 'object' }, effect: 'read', sensitivity: 'personal', confirmation: 'always', requiresForeground: false,
  requiredPermissions: [], timeoutMs: 10_000, maxConcurrency: 1, supportsCancellation: true, idempotent: true, resultKinds: ['json'],
}] };

function fixture() {
  const registry = new EndpointRegistry(), rows = new Map<string, ProviderRecord>();
  const store = { get: (key: string) => rows.get(key), set: (key: string, value: ProviderRecord) => { rows.set(key, structuredClone(value)); },
    entries: () => [...rows.entries()], setMany: (records: Array<[string, ProviderRecord]>) => { for (const [key, value] of records) rows.set(key, structuredClone(value)); } };
  const connect = (endpointId = 'desktop', connectionId = 'connection') => registry.register({
    principalId: 'principal', endpointId, connectionInstanceId: randomUUID(), displayName: 'Mac', kind: 'desktop', platform: 'mac',
    appVersion: '1', availability: 'foreground', nonce: randomUUID(), signedAt: Date.now(), signature: 'fixture-signature',
    tools: [deviceStateDescriptor('desktop', 'state')],
  }, connectionId, { readyState: 1, send() {}, close() {} });
  connect();
  let now = 100;
  return { registry, store, connect, advance: () => { now += 61_000; }, catalog: new EndpointProviderCatalog(registry, store, () => now) };
}

describe('provider catalog admission and lifecycle', () => {
  it('keeps claims non-executable until exact admission, then checks fresh readiness', () => {
    const { registry, catalog, advance } = fixture();
    catalog.replace('desktop', 'connection', { revision: 1, providers: [provider] });
    const record = catalog.list()[0];
    expect(record.status).toBe('authorization_required');
    expect(registry.getTool('desktop', 'provider_documents.Search-Docs')).toBeUndefined();
    catalog.admit('principal', 'documents', record.digest, true);
    expect(() => catalog.assertExecutable('desktop', 'provider_documents.Search-Docs')).toThrow('PROVIDER_UNAVAILABLE');
    catalog.reportState('desktop', 'connection', { localId: 'documents', catalogRevision: 1, sequence: 1, reason: 'ready', validForMs: 60_000 });
    expect(() => catalog.assertExecutable('desktop', 'provider_documents.Search-Docs')).not.toThrow();
    expect(registry.getTool('desktop', 'desktop.device.get_state')).toBeDefined();
    advance();
    expect(() => catalog.assertExecutable('desktop', 'provider_documents.Search-Docs')).toThrow('PROVIDER_UNAVAILABLE');
    catalog.admit('principal', 'documents', record.digest, false);
    expect(registry.getTool('desktop', 'provider_documents.Search-Docs')).toBeUndefined();
  });

  it('atomically rejects invalid catalogs and does not reuse admission after a contract change', () => {
    const { registry, catalog } = fixture();
    catalog.replace('desktop', 'connection', { revision: 1, providers: [provider] });
    const digest = catalog.list()[0].digest;
    catalog.admit('principal', 'documents', digest, true);
    const expanded = structuredClone(provider);
    expanded.tools[0].inputSchema = { $ref: 'https://example.com/remote' };
    expect(() => catalog.replace('desktop', 'connection', { revision: 2, providers: [expanded] })).toThrow('External');
    expect(catalog.list()[0].digest).toBe(digest);
    expect(registry.getTool('desktop', 'provider_documents.Search-Docs')).toBeDefined();
    expanded.tools[0].inputSchema = { type: 'object', properties: { path: { type: 'string' } } };
    catalog.replace('desktop', 'connection', { revision: 2, providers: [expanded] });
    expect(catalog.list()[0].admitted).toBe(false);
    expect(registry.getTool('desktop', 'provider_documents.Search-Docs')).toBeUndefined();
    expect(() => catalog.admit('principal', 'documents', digest, true)).toThrow('CONTRACT_CHANGED');
  });

  it('rejects simultaneous publication, replayed updates and late connections without losing offline metadata', () => {
    const { registry, catalog, connect, store } = fixture();
    catalog.replace('desktop', 'connection', { revision: 1, providers: [provider] });
    expect(() => catalog.replace('desktop', 'connection', { revision: 1, providers: [] })).toThrow('REVISION_CONFLICT');
    connect('another-tab', 'other-connection');
    expect(() => catalog.replace('another-tab', 'other-connection', { revision: 1, providers: [provider] })).toThrow('CONNECTION_CONFLICT');
    registry.remove('desktop', 'connection');
    expect(catalog.list()[0].status).toBe('offline');
    expect(new EndpointProviderCatalog(registry, store).list()[0].status).toBe('offline');
    expect(() => catalog.replace('desktop', 'connection', { revision: 2, providers: [] })).toThrow('no longer active');
    catalog.replace('another-tab', 'other-connection', { revision: 1, providers: [provider] });
    expect(catalog.list()[0].endpointId).toBe('another-tab');
    catalog.replace('another-tab', 'other-connection', { revision: 2, providers: [] });
    expect(catalog.list()[0].status).toBe('offline');
  });
});
