import { describe, expect, it } from 'vitest';

import { shouldSkipWebchatInboundByAbortCutoff } from '../abort-cutoff.js';

describe('shouldSkipWebchatInboundByAbortCutoff', () => {
  it('returns false when no cutoff', () => {
    expect(shouldSkipWebchatInboundByAbortCutoff({}, 100)).toBe(false);
    expect(shouldSkipWebchatInboundByAbortCutoff(null, 100)).toBe(false);
    expect(shouldSkipWebchatInboundByAbortCutoff(undefined, 100)).toBe(false);
  });

  it('returns false when clientCreatedAtMs is missing or non-finite', () => {
    expect(shouldSkipWebchatInboundByAbortCutoff({ abortCutoffTimestamp: 50 }, undefined)).toBe(false);
    expect(shouldSkipWebchatInboundByAbortCutoff({ abortCutoffTimestamp: 50 }, NaN)).toBe(false);
  });

  it('returns true when client time is on or before cutoff', () => {
    expect(shouldSkipWebchatInboundByAbortCutoff({ abortCutoffTimestamp: 100 }, 100)).toBe(true);
    expect(shouldSkipWebchatInboundByAbortCutoff({ abortCutoffTimestamp: 100 }, 99)).toBe(true);
  });

  it('returns false when client time is after cutoff', () => {
    expect(shouldSkipWebchatInboundByAbortCutoff({ abortCutoffTimestamp: 100 }, 101)).toBe(false);
  });
});
