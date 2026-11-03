import { describe, expect, it } from 'vitest';
import { BROWSER_CONTROL_ENDPOINT_DESCRIPTOR } from '@xopcai/browser-control-contract';
import { REMOTE_BROWSER_DESCRIPTOR } from '@xopcai/browser-control-contract/remote';
import { COMPUTER_DESCRIPTOR, REMOTE_COMPUTER_DESCRIPTOR } from '@xopcai/computer-control-contract';

import {
  ENDPOINT_CONTACT_OUTPUT_SCHEMA,
  ENDPOINT_TEXT_OUTPUT_SCHEMA,
  endpointHelloPayloadSchema,
} from '@xopcai/endpoint-tools-protocol';

import { EndpointToolPolicy } from '../policy.js';
import { EndpointRegistry } from '../registry.js';

const policy = new EndpointToolPolicy();

describe('EndpointToolPolicy', () => {
  it('preserves the local Computer contract and requires separate native confirmation for the remote transport', () => {
    expect(() => policy.validateDescriptor('desktop', COMPUTER_DESCRIPTOR as never)).not.toThrow();
    expect(() => policy.validateDescriptor('desktop', REMOTE_COMPUTER_DESCRIPTOR as never)).not.toThrow();
    expect(policy.evaluate(REMOTE_COMPUTER_DESCRIPTOR as never, 'foreground')).toEqual({ confirmationRequired: true });
    expect(() => policy.evaluate(REMOTE_COMPUTER_DESCRIPTOR as never, 'background')).toThrow('not in the foreground');
    for (const patch of [{ confirmation: 'never' }, { requiresForeground: false }, { timeoutMs: 60000 }, { maxConcurrency: 2 }, { policyId: 'computer.session-scoped' }]) {
      expect(() => policy.validateDescriptor('desktop', { ...REMOTE_COMPUTER_DESCRIPTOR, ...patch } as never)).toThrow();
    }
    expect(COMPUTER_DESCRIPTOR.confirmation).toBe('never');
    expect(COMPUTER_DESCRIPTOR.requiresForeground).toBe(false);
  });
  it('keeps remote Browser independent from the existing browser extension policy', () => {
    expect(() => policy.validateDescriptor('desktop', REMOTE_BROWSER_DESCRIPTOR as never)).not.toThrow();
    expect(policy.evaluate(REMOTE_BROWSER_DESCRIPTOR as never, 'foreground')).toEqual({ confirmationRequired: true });
    expect(() => policy.evaluate(REMOTE_BROWSER_DESCRIPTOR as never, 'background')).toThrow('not in the foreground');
    for (const patch of [{ confirmation: 'never' }, { requiresForeground: false }, { timeoutMs: 60000 }, { maxConcurrency: 4 }, { policyId: 'browser.control' }]) {
      expect(() => policy.validateDescriptor('desktop', { ...REMOTE_BROWSER_DESCRIPTOR, ...patch } as never)).toThrow();
    }
    expect(BROWSER_CONTROL_ENDPOINT_DESCRIPTOR.confirmation).toBe('never');
    expect(BROWSER_CONTROL_ENDPOINT_DESCRIPTOR.maxConcurrency).toBe(4);
  });
  it('registers the browser control catalog with its concurrency limit', () => {
    const registry = new EndpointRegistry();
    const hello = endpointHelloPayloadSchema.parse({
      principalId: 'chrome-device', endpointId: 'chrome-extension',
      connectionInstanceId: '11111111-1111-4111-8111-111111111111',
      displayName: 'Chrome', kind: 'browser', platform: 'chrome', appVersion: 'test',
      availability: 'foreground', nonce: 'test-nonce', signedAt: Date.now(), signature: 'test-signature-placeholder',
      tools: [BROWSER_CONTROL_ENDPOINT_DESCRIPTOR],
    });
    const registered = registry.register(hello, 'connection', { readyState: 1, send: () => {}, close: () => {} });
    expect(registered.connection.tools.map((tool) => [tool.descriptor.name, tool.descriptor.maxConcurrency]))
      .toEqual([['browser.control', 4]]);
    expect(registry.verifyTurnClaim(hello.endpointId, registered.turnToken)).toBe(true);
  });

  it.each([
    { descriptor: BROWSER_CONTROL_ENDPOINT_DESCRIPTOR, maxConcurrency: 1 },
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

  it('rejects retired mobile policy identifiers', () => {
    expect(() => policy.validateDescriptor('mobile', {
      name: 'mobile.contacts.pick', title: 'Pick', description: 'Pick a contact.',
      inputSchema: { type: 'object' }, outputSchema: ENDPOINT_CONTACT_OUTPUT_SCHEMA,
      policyId: 'personal.foreground-read', sensitivity: 'personal', effect: 'read',
      confirmation: 'always', requiresForeground: true, requiredPermissions: ['contacts-read-selected'],
      timeoutMs: 1_000, maxConcurrency: 1, supportsCancellation: false, idempotent: false,
      resultKinds: ['json'],
    })).toThrow();
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
