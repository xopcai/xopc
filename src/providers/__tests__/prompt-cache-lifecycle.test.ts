import { beforeEach, describe, expect, it } from 'vitest';
import type { Api, Model } from '@earendil-works/pi-ai';

import {
  clearPromptCacheTouches,
  isPromptCacheExpired,
  recordPromptCacheTouch,
  resolvePromptCacheTtlMs,
} from '../prompt-cache-lifecycle.js';

const anthropic = { provider: 'anthropic', id: 'claude', api: 'anthropic-messages' } as Model<Api>;
const openai = { provider: 'openai', id: 'gpt-5.6', api: 'openai-responses' } as Model<Api>;

describe('prompt cache lifecycle', () => {
  beforeEach(clearPromptCacheTouches);

  it('uses provider-aware semantic lifetimes', () => {
    expect(resolvePromptCacheTtlMs(anthropic, { mode: 'auto', lifetime: 'short' })).toBe(5 * 60_000);
    expect(resolvePromptCacheTtlMs(anthropic, { mode: 'auto', lifetime: 'long' })).toBe(60 * 60_000);
    expect(resolvePromptCacheTtlMs(openai, { mode: 'auto', lifetime: 'short' })).toBe(30 * 60_000);
  });

  it('expires only after a real cache read or write', () => {
    const policy = { mode: 'auto' as const, lifetime: 'short' as const };
    expect(isPromptCacheExpired('session', anthropic, policy, 10_000_000)).toBe(false);
    recordPromptCacheTouch('session', anthropic, { cacheRead: 100 }, 1_000);
    expect(isPromptCacheExpired('session', anthropic, policy, 300_999)).toBe(false);
    expect(isPromptCacheExpired('session', anthropic, policy, 301_000)).toBe(true);
    expect(isPromptCacheExpired(
      'session',
      anthropic,
      { mode: 'off', lifetime: 'short' },
      301_000,
    )).toBe(false);
  });
});
