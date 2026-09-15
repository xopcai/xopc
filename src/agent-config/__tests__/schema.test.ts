import { describe, expect, it } from 'vitest';

import { AgentsConfigSchema, RuntimePolicySchema } from '../schema.js';

describe('AgentsConfigSchema', () => {
  it('creates one valid default agent configuration', () => {
    const result = AgentsConfigSchema.parse({});

    expect(result.default).toBe('main');
    expect(result.list).toEqual([{ id: 'main', enabled: true }]);
    expect(result.defaults.models.chat.primary).toContain('/');
  });

  it('rejects duplicate ids and an unavailable default agent', () => {
    const result = AgentsConfigSchema.safeParse({
      default: 'missing',
      list: [{ id: 'main' }, { id: 'main' }],
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.map((issue) => issue.message)).toEqual(expect.arrayContaining([
      'duplicate agent id "main"',
      'default agent "missing" must reference an enabled entry',
    ]));
  });
});

it('keeps host opt-in configuration compatible and defaults Docker to read-only and offline', () => {
  expect(RuntimePolicySchema.parse({}).commandIsolation).toBeUndefined();
  expect(RuntimePolicySchema.parse({ commandIsolation: { mode: 'host' } }).commandIsolation).toEqual({ mode: 'host' });
  const image = `fixture@sha256:${'0'.repeat(64)}`;
  expect(RuntimePolicySchema.parse({ commandIsolation: { mode: 'docker', image } }).commandIsolation)
    .toEqual({ mode: 'docker', image, network: false, workspaceAccess: 'read-only' });
  expect(RuntimePolicySchema.parse({ commandIsolation: { mode: 'docker', image, workspaceAccess: 'read-write' } }).commandIsolation)
    .toMatchObject({ workspaceAccess: 'read-write', network: false });
  expect(RuntimePolicySchema.safeParse({ commandIsolation: { mode: 'docker', image, workspaceAccess: 'anything' } }).success).toBe(false);
});
