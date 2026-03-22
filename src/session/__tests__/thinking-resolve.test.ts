import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveEffectiveThinkingLevel } from '../thinking-resolve.js';
import type { SessionConfigStore } from '../config-store.js';

describe('resolveEffectiveThinkingLevel', () => {
  let store: { get: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    store = { get: vi.fn().mockResolvedValue(null) };
  });

  it('uses request override when valid', async () => {
    const level = await resolveEffectiveThinkingLevel(
      store as unknown as SessionConfigStore,
      'sk',
      'high',
      'medium',
    );
    expect(level).toBe('high');
    expect(store.get).not.toHaveBeenCalled();
  });

  it('falls back to session store when no override', async () => {
    store.get.mockResolvedValue({ thinkingLevel: 'low' });
    const level = await resolveEffectiveThinkingLevel(
      store as unknown as SessionConfigStore,
      'sk',
      undefined,
      'medium',
    );
    expect(level).toBe('low');
  });

  it('falls back to agent default when session empty', async () => {
    const level = await resolveEffectiveThinkingLevel(
      store as unknown as SessionConfigStore,
      'sk',
      null,
      'adaptive',
    );
    expect(level).toBe('adaptive');
  });

  it('uses medium when nothing else applies', async () => {
    const level = await resolveEffectiveThinkingLevel(
      store as unknown as SessionConfigStore,
      'sk',
      null,
      undefined,
    );
    expect(level).toBe('medium');
  });
});
