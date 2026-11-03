import type { OAuthAuth, ProviderAuthInteraction } from '@earendil-works/pi-ai';
import { describe, expect, it, vi } from 'vitest';

import { piOAuthAdapter } from '../oauth/pi-oauth-adapter.js';
import { getOAuthProviderDefinition } from '../oauth/registry.js';
import type { OAuthLoginCallbacks } from '../oauth/types.js';

function callbacks(signal?: AbortSignal): OAuthLoginCallbacks {
  return { signal, onAuth: vi.fn(), onDeviceCode: vi.fn(), onProgress: vi.fn(),
    onPrompt: vi.fn().mockResolvedValue('code'), onSelect: vi.fn().mockResolvedValue('choice') };
}

describe('pi OAuth adapter', () => {
  it('delegates login prompts, notifications and cancellation to pi', async () => {
    const abort = new AbortController();
    const cb = callbacks(abort.signal);
    const login = vi.fn(async (interaction: ProviderAuthInteraction) => {
      expect(interaction.signal).toBe(abort.signal);
      await expect(interaction.prompt({ type: 'text', message: 'Code' })).resolves.toBe('code');
      await expect(interaction.prompt({ type: 'select', message: 'Account', options: [{ id: 'choice', label: 'Account' }] })).resolves.toBe('choice');
      interaction.notify({ type: 'auth_url', url: 'https://example.com/login', instructions: 'Sign in' });
      interaction.notify({ type: 'device_code', userCode: '1234', verificationUri: 'https://example.com/device' });
      interaction.notify({ type: 'progress', message: 'Waiting' });
      return { type: 'oauth' as const, access: 'access', refresh: 'refresh', expires: 123, accountId: 'account' };
    });
    const provider = piOAuthAdapter('test', 'Test', () => ({ login } as unknown as OAuthAuth));
    await expect(provider.login(cb)).resolves.toEqual({ access: 'access', refresh: 'refresh', expires: 123, accountId: 'account' });
    expect(login).toHaveBeenCalledOnce();
    expect(cb.onAuth).toHaveBeenCalledWith({ url: 'https://example.com/login', instructions: 'Sign in' });
    expect(cb.onDeviceCode).toHaveBeenCalledWith(expect.objectContaining({ userCode: '1234' }));
    expect(cb.onProgress).toHaveBeenCalledWith('Waiting');
  });

  it('delegates token refresh with the provider fields and abort signal intact', async () => {
    const signal = new AbortController().signal;
    const refresh = vi.fn().mockResolvedValue({ type: 'oauth', access: 'new', refresh: 'rotated', expires: 456, accountId: 'account' });
    const provider = piOAuthAdapter('test', 'Test', () => ({ refresh } as unknown as OAuthAuth));
    const credential = { access: 'old', refresh: 'refresh', expires: 123, accountId: 'account' };
    await expect(provider.refreshToken(credential, signal)).resolves.toEqual({ access: 'new', refresh: 'rotated', expires: 456, accountId: 'account' });
    expect(refresh).toHaveBeenCalledWith({ ...credential, type: 'oauth' }, signal);
    expect(provider.getApiKey(credential)).toBe('old');
  });

  it('does not register unsupported MiniMax OAuth flows', () => {
    expect(getOAuthProviderDefinition('minimax')).toBeUndefined();
    expect(getOAuthProviderDefinition('minimax-cn')).toBeUndefined();
    expect(getOAuthProviderDefinition('anthropic')?.provider.id).toBe('anthropic');
    expect(getOAuthProviderDefinition('kimi-coding')?.provider.id).toBe('kimi-coding');
  });
});
