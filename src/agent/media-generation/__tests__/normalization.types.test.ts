import { describe, expect, it } from 'vitest';

import { hasMediaNormalizationEntry } from '../normalization.types.js';

describe('hasMediaNormalizationEntry', () => {
  it('returns false for undefined', () => {
    expect(hasMediaNormalizationEntry(undefined)).toBe(false);
  });

  it('returns false for empty entry', () => {
    expect(hasMediaNormalizationEntry({})).toBe(false);
  });

  it('returns true when only requested is present', () => {
    expect(hasMediaNormalizationEntry({ requested: '1024x1024' })).toBe(true);
  });

  it('returns true when only applied is present', () => {
    expect(hasMediaNormalizationEntry({ applied: '1024x1024' })).toBe(true);
  });

  it('returns true when only derivedFrom is present', () => {
    expect(hasMediaNormalizationEntry({ derivedFrom: 'aspectRatio' })).toBe(true);
  });

  it('treats supportedValues alone as not-yet-an-entry', () => {
    expect(hasMediaNormalizationEntry({ supportedValues: ['1024x1024'] })).toBe(false);
  });
});
