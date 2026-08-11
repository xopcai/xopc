import { describe, expect, it } from 'vitest';

import { resolveOAuthLoginMethodPreference } from './oauth-async.js';

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
