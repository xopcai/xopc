import { describe, expect, it, vi } from 'vitest';

import type { GatewayService } from '../service.js';
import { ConfigSchema } from '../../config/schema.js';
import {
  buildDesktopOAuthReturnUrl,
  buildOAuthCompletionReadiness,
  normalizeDesktopOAuthReturnPath,
  refreshModelCatalogAfterOAuth,
  resolveOAuthLoginMethodPreference,
} from './oauth-async.js';

describe('buildDesktopOAuthReturnUrl', () => {
  it('uses a dedicated Electron callback for tunnel authorization', () => {
    expect(buildDesktopOAuthReturnUrl(
      'xopc-tunnel',
      'oauth-test',
      '/settings/remote-access?tab=public',
    )).toBe(
      'xopc://cloud/tunnel-connected?request_id=oauth-test&return_path=%2Fsettings%2Fremote-access%3Ftab%3Dpublic',
    );
  });

  it('keeps model authorization on its dedicated callback', () => {
    expect(buildDesktopOAuthReturnUrl('xopc-cloud', 'oauth-test', undefined)).toBe(
      'xopc://cloud/model-connected?request_id=oauth-test',
    );
  });

  it('does not create Electron callbacks for unrelated OAuth providers', () => {
    expect(buildDesktopOAuthReturnUrl('google-gemini-cli', 'oauth-test', '/chat')).toBeUndefined();
  });
});

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
    ).resolves.toMatchObject({
      state: 'unavailable',
      error: { code: 'refresh_failed', message: 'rate limited', retryable: true },
    });
  });
});

describe('buildOAuthCompletionReadiness', () => {
  it('marks authorization as connected-degraded when catalog setup fails', () => {
    const readiness = buildOAuthCompletionReadiness(ConfigSchema.parse({}), {
      state: 'unavailable',
      source: 'none',
      modelCount: 0,
      error: { code: 'refresh_failed', message: 'offline', retryable: true },
    });

    expect(readiness).toMatchObject({
      authorized: true,
      state: 'connected-degraded',
      catalog: { state: 'unavailable' },
    });
  });
});
