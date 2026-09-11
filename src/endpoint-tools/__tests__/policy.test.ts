import { describe, expect, it } from 'vitest';

import {
  ENDPOINT_CONTACT_OUTPUT_SCHEMA,
  ENDPOINT_TEXT_OUTPUT_SCHEMA,
} from '@xopcai/endpoint-tools-protocol';

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
