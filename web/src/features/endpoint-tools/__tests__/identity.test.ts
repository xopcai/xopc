import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('web endpoint instance identity', () => {
  beforeEach(() => {
    vi.resetModules();
    const values = new Map<string, string>();
    vi.stubGlobal('sessionStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('rotates the endpoint instance id when its principal changes', async () => {
    const { getEndpointId } = await import('../identity');
    const first = getEndpointId('principal-1');
    expect(getEndpointId('principal-1')).toBe(first);
    const second = getEndpointId('principal-2');
    expect(second).not.toBe(first);
    expect(second.startsWith('principal-2:')).toBe(true);
  });
});
