import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ files: new Map<string, string>() }));
vi.mock('electron', () => ({ app: { getPath: () => '/fixture' } }));
vi.mock('node:fs/promises', () => ({ readFile: async (path: string) => {
  const value = state.files.get(path);
  if (value === undefined) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
  return value;
} }));
vi.mock('../../../src/infra/write-file-atomic.js', () => ({ writeTextAtomic: async (path: string, value: string) => { state.files.set(path, value); } }));

import { ComputerAccessPolicy } from '../access-policy.js';

beforeEach(() => state.files.clear());

describe('computer access policy', () => {
  it('starts closed and persists explicit application grants', async () => {
    const policy = new ComputerAccessPolicy();
    expect(await policy.allows('com.example.Notes')).toBe(false);
    await policy.set('com.example.Notes', true);
    expect(await new ComputerAccessPolicy().allows('com.example.Notes')).toBe(true);
    await policy.set('com.example.Notes', false);
    expect(await new ComputerAccessPolicy().allows('com.example.Notes')).toBe(false);
  });

  it('rejects malformed policy instead of widening access', async () => {
    state.files.set('/fixture/computer-access-policy.json', '{"authorizedAppIds":["com.example.Notes"]}');
    await expect(new ComputerAccessPolicy().allows('com.example.Notes')).rejects.toThrow();
  });
});
