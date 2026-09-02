import { describe, expect, it } from 'vitest';

import { ENDPOINT_TEXT_OUTPUT_SCHEMA } from '@xopcai/endpoint-tools-protocol';

import { EndpointToolPolicy } from '../policy.js';

const policy = new EndpointToolPolicy();

describe('EndpointToolPolicy', () => {
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
