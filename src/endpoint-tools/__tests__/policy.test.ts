import { describe, expect, it } from 'vitest';

import { EndpointToolPolicy } from '../policy.js';

const policy = new EndpointToolPolicy();

describe('EndpointToolPolicy', () => {
  it('rejects tools outside their endpoint namespace', () => {
    expect(() => policy.validateDescriptor('mobile', {
      name: 'web.page.read', title: 'Read', description: 'Read.',
      inputSchema: { type: 'object' }, effect: 'read', confirmation: 'never',
      requiresForeground: false, requiredPermissions: [], timeoutMs: 1_000,
      maxConcurrency: 1, supportsCancellation: false, idempotent: true,
      resultKinds: ['text'],
    })).toThrow('does not belong to mobile');
  });

  it('requires confirmation, foreground, and permissions for mutations', () => {
    expect(() => policy.validateDescriptor('web', {
      name: 'web.clipboard.write', title: 'Write', description: 'Write.',
      inputSchema: { type: 'object' }, effect: 'write', confirmation: 'never',
      requiresForeground: false, requiredPermissions: [], timeoutMs: 1_000,
      maxConcurrency: 1, supportsCancellation: false, idempotent: true,
      resultKinds: ['text'],
    })).toThrow('must always require confirmation');
  });
});
