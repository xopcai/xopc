import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_ACTIVITY_DETAIL_LEVEL,
  resolveConfiguredActivityDetailDefault,
  resolveEffectiveReasoningLevel,
  resolveEffectiveThinkingLevel,
} from '../thinking-resolve.js';
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

describe('activity detail resolution', () => {
  it('defaults to the calm collapsed mode', () => {
    expect(DEFAULT_ACTIVITY_DETAIL_LEVEL).toBe('on');
    expect(resolveConfiguredActivityDetailDefault()).toBe('on');
  });

  it('uses the configured Web UI default', () => {
    expect(resolveConfiguredActivityDetailDefault({
      gateway: { webchat: { activityDetailDefault: 'stream' } },
    })).toBe('stream');
  });

  it('prefers the session override over the configured default', async () => {
    const store = {
      get: async () => ({ reasoningLevel: 'off' as const }),
    };

    await expect(resolveEffectiveReasoningLevel(store as never, 'session', 'stream')).resolves.toBe('off');
  });
});
