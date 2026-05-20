import { describe, expect, it, vi } from 'vitest';

import { FileReferenceRegistry } from '../file-reference-registry.js';

describe('FileReferenceRegistry', () => {
  it('registers a short-lived file reference with deduplicated capabilities', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-05-20T00:00:00.000Z'));
      const registry = new FileReferenceRegistry();
      const ref = registry.register({
        absolutePath: '/tmp/report.md',
        sessionKey: ' coder:webchat ',
        scope: 'external',
        capabilities: ['openExternal', 'openExternal', 'revealInFolder'],
        ttlMs: 1000,
      });

      expect(ref.sessionKey).toBe('coder:webchat');
      expect(ref.capabilities).toEqual(['openExternal', 'revealInFolder']);
      expect(registry.resolve(ref.id)).toEqual(ref);
    } finally {
      vi.useRealTimers();
    }
  });

  it('expires references after ttl', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-05-20T00:00:00.000Z'));
      const registry = new FileReferenceRegistry();
      const ref = registry.register({
        absolutePath: '/tmp/report.md',
        scope: 'external',
        capabilities: ['openExternal'],
        ttlMs: 1000,
      });

      vi.setSystemTime(new Date('2026-05-20T00:00:01.001Z'));
      expect(registry.resolve(ref.id)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
