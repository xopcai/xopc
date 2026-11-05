import { describe, expect, it } from 'vitest';

import { assertProviderSchemaBudget, capabilityProviderSchema, providerCatalogSchema, providerToolName, providerEndpointDescriptor } from './providers.js';

const tool = { name: 'Search-Docs', title: 'Search', description: 'Search documents', inputSchema: { type: 'object' },
  effect: 'read', sensitivity: 'personal', confirmation: 'always', requiresForeground: false, requiredPermissions: [],
  timeoutMs: 10_000, maxConcurrency: 1, supportsCancellation: true, idempotent: true, resultKinds: ['text'] };
const provider = { localId: 'documents', title: 'Documents', summary: 'Local documents', tools: [tool] };

describe('capability provider contract', () => {
  it('requires local confirmation for provider mutations', () => {
    expect(() => providerEndpointDescriptor('documents', { ...tool, effect: 'write', confirmation: 'never' } as any)).toThrow('confirmation');
  });
  it('preserves MCP names and optional output schemas without changing native contracts', () => {
    expect(capabilityProviderSchema.parse(provider).tools[0].name).toBe('Search-Docs');
    expect(providerToolName('documents', 'Search-Docs')).not.toBe(providerToolName('archive', 'Search-Docs'));
    expect(() => providerToolName('native', 'search')).toThrow();
  });
  it('rejects duplicate identities, tools, unknown fields and oversized descriptions', () => {
    expect(() => providerCatalogSchema.parse({ revision: 1, providers: [provider, provider] })).toThrow();
    expect(() => capabilityProviderSchema.parse({ ...provider, tools: [tool, tool] })).toThrow();
    expect(() => capabilityProviderSchema.parse({ ...provider, principalId: 'another-device' })).toThrow();
    expect(() => capabilityProviderSchema.parse({ ...provider, instructions: 'x'.repeat(8_001) })).toThrow();
  });
  it('bounds schema depth, nodes, remote references and untrusted regex compilation', () => {
    expect(() => assertProviderSchemaBudget({ type: 'object', properties: { a: { type: 'string' } } })).not.toThrow();
    expect(() => assertProviderSchemaBudget({ $ref: 'https://example.com/schema' })).toThrow('External');
    expect(() => assertProviderSchemaBudget({ pattern: '(a+)+$' })).toThrow('regular expressions');
    expect(() => assertProviderSchemaBudget({ $ref: '#/$defs/cycle', $defs: { cycle: { $ref: '#/$defs/cycle' } } })).toThrow('Recursive');
    let nested: unknown = {};
    for (let i = 0; i < 30; i++) nested = { properties: { child: nested } };
    expect(() => assertProviderSchemaBudget(nested)).toThrow('complexity');
    expect(() => assertProviderSchemaBudget(Array.from({ length: 8_001 }, () => null))).toThrow('complexity');
  });
});
