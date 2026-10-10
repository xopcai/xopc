import { describe, expect, it } from 'vitest';
import { BROWSER_CONTROL_ENDPOINT_DESCRIPTOR, BROWSER_RECORDING_ENDPOINT_DESCRIPTOR } from '@xopcai/browser-control-contract';

import {
  ENDPOINT_CONTACT_OUTPUT_SCHEMA,
  ENDPOINT_TEXT_OUTPUT_SCHEMA,
  endpointHelloPayloadSchema,
} from '@xopcai/endpoint-tools-protocol';

import { EndpointToolPolicy } from '../policy.js';
import { EndpointRegistry } from '../registry.js';

const policy = new EndpointToolPolicy();

describe('EndpointToolPolicy', () => {
  it('registers the real browser control and recording catalog with their individual concurrency limits', () => {
    const registry = new EndpointRegistry();
    const hello = endpointHelloPayloadSchema.parse({
      principalId: 'chrome-device', endpointId: 'chrome-extension',
      connectionInstanceId: '11111111-1111-4111-8111-111111111111',
      displayName: 'Chrome', kind: 'browser', platform: 'chrome', appVersion: 'test',
      availability: 'foreground', nonce: 'test-nonce', signedAt: Date.now(), signature: 'test-signature-placeholder',
      tools: [BROWSER_CONTROL_ENDPOINT_DESCRIPTOR, BROWSER_RECORDING_ENDPOINT_DESCRIPTOR],
    });
    const registered = registry.register(hello, 'connection', { readyState: 1, send: () => {}, close: () => {} });
    expect(registered.connection.tools.map((tool) => [tool.descriptor.name, tool.descriptor.maxConcurrency]))
      .toEqual([['browser.control', 4], ['browser.recording', 1]]);
    expect(registry.verifyTurnClaim(hello.endpointId, registered.turnToken)).toBe(true);
  });

  it.each([
    { descriptor: BROWSER_CONTROL_ENDPOINT_DESCRIPTOR, maxConcurrency: 1 },
    { descriptor: BROWSER_RECORDING_ENDPOINT_DESCRIPTOR, maxConcurrency: 4 },
  ])('rejects modified concurrency for $descriptor.name', ({ descriptor, maxConcurrency }) => {
    expect(() => policy.validateDescriptor('browser', { ...descriptor, maxConcurrency } as never)).toThrow('violates its trusted policy');
  });

  it('accepts only the trusted internal browser-control transport contract', () => {
    expect(() => policy.validateDescriptor(
      'browser',
      BROWSER_CONTROL_ENDPOINT_DESCRIPTOR as never,
    )).not.toThrow();
    expect(() => policy.validateDescriptor('browser', {
      ...BROWSER_CONTROL_ENDPOINT_DESCRIPTOR,
      requiredPermissions: [],
    } as never)).toThrow('trusted server contract');
  });

  it('rejects browser control descriptors with a modified input contract', () => {
    expect(() => policy.validateDescriptor('browser', {
      ...BROWSER_CONTROL_ENDPOINT_DESCRIPTOR,
      inputSchema: { type: 'object' },
    } as never)).toThrow('trusted server contract');
  });

  it('rejects tools outside their endpoint namespace', () => {
    expect(() => policy.validateDescriptor('mobile', {
      name: 'web.page.read', title: 'Read', description: 'Read.',
      inputSchema: { type: 'object' }, effect: 'read', confirmation: 'never',
      outputSchema: ENDPOINT_TEXT_OUTPUT_SCHEMA,
      policyId: 'public.foreground-read', sensitivity: 'public',
      requiresForeground: false, requiredPermissions: [], timeoutMs: 1_000,
      maxConcurrency: 1, supportsCancellation: false, idempotent: true,
      resultKinds: ['text'],
    })).toThrow('does not belong to mobile');
  });

  it('requires confirmation, foreground, and permissions for mutations', () => {
    expect(() => policy.validateDescriptor('web', {
      name: 'web.clipboard.write', title: 'Write', description: 'Write.',
      inputSchema: { type: 'object' }, effect: 'write', confirmation: 'never',
      outputSchema: ENDPOINT_TEXT_OUTPUT_SCHEMA,
      policyId: 'user.foreground-write', sensitivity: 'personal',
      requiresForeground: false, requiredPermissions: ['clipboard-write'], timeoutMs: 1_000,
      maxConcurrency: 1, supportsCancellation: false, idempotent: true,
      resultKinds: ['text'],
    })).toThrow('violates its trusted policy');
  });

  it('allows trusted system-mediated mobile actions without a second confirmation', () => {
    expect(() => policy.validateDescriptor('mobile', {
      name: 'mobile.contacts.pick', title: 'Pick', description: 'Pick a contact.',
      inputSchema: { type: 'object' }, outputSchema: ENDPOINT_CONTACT_OUTPUT_SCHEMA,
      policyId: 'personal.foreground-mediated-read', sensitivity: 'personal', effect: 'read',
      confirmation: 'never', requiresForeground: true, requiredPermissions: ['contacts-read-selected'],
      timeoutMs: 1_000, maxConcurrency: 1, supportsCancellation: false, idempotent: false,
      resultKinds: ['json'],
    })).not.toThrow();

    expect(() => policy.validateDescriptor('mobile', {
      name: 'mobile.file.share', title: 'Share', description: 'Open the system share sheet.',
      inputSchema: { type: 'object' }, outputSchema: ENDPOINT_TEXT_OUTPUT_SCHEMA,
      policyId: 'user.foreground-mediated-write', sensitivity: 'personal', effect: 'write',
      confirmation: 'never', requiresForeground: true, requiredPermissions: ['file-share'],
      timeoutMs: 1_000, maxConcurrency: 1, supportsCancellation: false, idempotent: false,
      resultKinds: ['text'],
    })).not.toThrow();
  });

  it('keeps older, more restrictive mobile descriptors valid during gateway-first rollout', () => {
    expect(() => policy.validateDescriptor('mobile', {
      name: 'mobile.contacts.pick', title: 'Pick', description: 'Pick a contact.',
      inputSchema: { type: 'object' }, outputSchema: ENDPOINT_CONTACT_OUTPUT_SCHEMA,
      policyId: 'personal.foreground-read', sensitivity: 'personal', effect: 'read',
      confirmation: 'always', requiresForeground: true, requiredPermissions: ['contacts-read-selected'],
      timeoutMs: 1_000, maxConcurrency: 1, supportsCancellation: false, idempotent: false,
      resultKinds: ['json'],
    })).not.toThrow();
  });

  it('rejects a known personal tool claiming a weaker policy', () => {
    expect(() => policy.validateDescriptor('mobile', {
      name: 'mobile.contacts.search', title: 'Search', description: 'Search contacts.',
      inputSchema: { type: 'object' }, outputSchema: ENDPOINT_TEXT_OUTPUT_SCHEMA,
      policyId: 'public.background-read', sensitivity: 'public', effect: 'read',
      confirmation: 'never', requiresForeground: false, requiredPermissions: [], timeoutMs: 1_000,
      maxConcurrency: 1, supportsCancellation: false, idempotent: true, resultKinds: ['text'],
    })).toThrow('does not match its trusted server policy');
  });

  it('rejects tools that have not been admitted to the server policy catalog', () => {
    expect(() => policy.validateDescriptor('mobile', {
      name: 'mobile.contacts.export_all', title: 'Export', description: 'Export contacts.',
      inputSchema: { type: 'object' }, outputSchema: ENDPOINT_TEXT_OUTPUT_SCHEMA,
      policyId: 'personal.foreground-read', sensitivity: 'personal', effect: 'read',
      confirmation: 'always', requiresForeground: true, requiredPermissions: ['contacts-read'],
      timeoutMs: 1_000, maxConcurrency: 1, supportsCancellation: false, idempotent: true,
      resultKinds: ['text'],
    })).toThrow('has no trusted server policy');
  });

  it('rejects a known tool with a client-loosened output schema', () => {
    expect(() => policy.validateDescriptor('mobile', {
      name: 'mobile.contacts.search', title: 'Search', description: 'Search contacts.',
      inputSchema: { type: 'object' }, outputSchema: {},
      policyId: 'personal.foreground-read', sensitivity: 'personal', effect: 'read',
      confirmation: 'always', requiresForeground: true, requiredPermissions: ['contacts-read'],
      timeoutMs: 1_000, maxConcurrency: 1, supportsCancellation: false, idempotent: true,
      resultKinds: ['json'],
    })).toThrow('does not match its trusted server contract');
  });
});
