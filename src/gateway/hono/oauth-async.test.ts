import { describe, expect, it, vi } from 'vitest';

import type { GatewayService } from '../service.js';
import {
  normalizeDesktopOAuthReturnPath,
  refreshModelCatalogAfterOAuth,
  resolveOAuthLoginMethodPreference,
} from './oauth-async.js';

describe('normalizeDesktopOAuthReturnPath', () => {
  it('accepts internal routes and rejects external or malformed paths', () => {
    expect(normalizeDesktopOAuthReturnPath('/chat?onboarding=1')).toBe('/chat?onboarding=1');
    expect(normalizeDesktopOAuthReturnPath('//evil.example')).toBeUndefined();
    expect(normalizeDesktopOAuthReturnPath('https://evil.example')).toBeUndefined();
    expect(normalizeDesktopOAuthReturnPath('/chat\\evil')).toBeUndefined();
  });
});

describe('resolveOAuthLoginMethodPreference', () => {
  const supportedMethods = ['browser', 'device_code'] as const;

  it('uses device code for a remote client when the provider supports both flows', () => {
    expect(resolveOAuthLoginMethodPreference({ remote: true, supportedMethods })).toBe('device_code');
  });

  it('lets a local client use the provider browser default', () => {
    expect(resolveOAuthLoginMethodPreference({ remote: false, supportedMethods })).toBeUndefined();
  });

  it('honors a supported explicit method', () => {
    expect(resolveOAuthLoginMethodPreference({
      remote: true,
      supportedMethods,
      requestedMethod: 'browser',
    })).toBe('browser');
  });

  it('rejects an unsupported explicit method for capability-aware providers', () => {
    expect(resolveOAuthLoginMethodPreference({
      remote: false,
      supportedMethods,
      requestedMethod: 'manual',
    })).toBeUndefined();
  });
});

describe('refreshModelCatalogAfterOAuth', () => {
  function serviceWith(refreshNow: () => Promise<unknown>) {
    return {
      getModelCatalogSync: () => ({ refreshNow }),
    } as unknown as Pick<GatewayService, 'getModelCatalogSync'>;
  }

  it('refreshes XOPC Cloud models after credentials are persisted', async () => {
    const refreshNow = vi.fn(async () => ({ status: 'updated' }));

    await refreshModelCatalogAfterOAuth('xopc-cloud', serviceWith(refreshNow));

    expect(refreshNow).toHaveBeenCalledOnce();
  });

  it('does not refresh unrelated OAuth providers', async () => {
    const refreshNow = vi.fn(async () => ({ status: 'updated' }));

    await refreshModelCatalogAfterOAuth('google-gemini-cli', serviceWith(refreshNow));

    expect(refreshNow).not.toHaveBeenCalled();
  });

  it('keeps a successful OAuth connection when model refresh is temporarily unavailable', async () => {
    const refreshNow = vi.fn(async () => { throw new Error('rate limited'); });

    await expect(
      refreshModelCatalogAfterOAuth('xopc-cloud', serviceWith(refreshNow)),
    ).resolves.toBeUndefined();
  });
});
