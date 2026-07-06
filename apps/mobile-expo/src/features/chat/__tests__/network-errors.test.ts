import { describe, expect, it } from 'vitest';

import {
  isTransientNetworkError,
  streamRetryDelayMs,
  STREAM_RECOVERY_MAX_ATTEMPTS,
} from '../network-errors';

describe('isTransientNetworkError', () => {
  it('detects React Native xhr network failures', () => {
    expect(isTransientNetworkError('Network request failed')).toBe(true);
  });

  it('detects fetch and timeout failures', () => {
    expect(isTransientNetworkError('Failed to fetch')).toBe(true);
    expect(isTransientNetworkError('The request timed out')).toBe(true);
  });

  it('ignores server-side application errors', () => {
    expect(isTransientNetworkError('HTTP 401 Unauthorized')).toBe(false);
    expect(isTransientNetworkError('Send failed')).toBe(false);
  });
});

describe('streamRetryDelayMs', () => {
  it('uses exponential backoff capped at 30s', () => {
    expect(streamRetryDelayMs(1)).toBe(1000);
    expect(streamRetryDelayMs(3)).toBe(4000);
    expect(streamRetryDelayMs(10)).toBe(30_000);
  });
});

describe('STREAM_RECOVERY_MAX_ATTEMPTS', () => {
  it('allows several silent retries before surfacing UI', () => {
    expect(STREAM_RECOVERY_MAX_ATTEMPTS).toBeGreaterThanOrEqual(5);
  });
});
