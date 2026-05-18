import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../auth/sync-provider-auth.js', () => ({
  resolveProviderApiKeySync: vi.fn((provider: string) =>
    provider === 'deepseek' ? 'sk-from-profiles' : undefined,
  ),
}));

vi.mock('../../../providers/index.js', () => ({
  getApiKeySync: vi.fn((provider: string) =>
    provider === 'openai' ? 'sk-from-env-registry' : undefined,
  ),
}));

import { resolveXopcProviderApiKey } from '../xopc-auth-storage.js';
import { resolveProviderApiKeySync } from '../../../auth/sync-provider-auth.js';
import { getApiKeySync } from '../../../providers/index.js';

describe('resolveXopcProviderApiKey', () => {
  it('prefers auth-profiles sync resolution', () => {
    expect(resolveXopcProviderApiKey('deepseek')).toBe('sk-from-profiles');
    expect(resolveProviderApiKeySync).toHaveBeenCalledWith('deepseek');
    expect(getApiKeySync).not.toHaveBeenCalledWith('deepseek');
  });

  it('falls back to registry / env sync path', () => {
    expect(resolveXopcProviderApiKey('openai')).toBe('sk-from-env-registry');
    expect(getApiKeySync).toHaveBeenCalledWith('openai');
  });

  it('returns undefined when nothing is configured', () => {
    expect(resolveXopcProviderApiKey('unknown-vendor')).toBeUndefined();
  });
});
