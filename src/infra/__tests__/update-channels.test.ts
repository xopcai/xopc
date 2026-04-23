import { describe, expect, it } from 'vitest';

import {
  channelToNpmTag,
  normalizeUpdateChannel,
  isBetaVersion,
  isStableVersion,
} from '../update-channels.js';

describe('update-channels', () => {
  it('channelToNpmTag maps stable/beta/dev', () => {
    expect(channelToNpmTag('stable')).toBe('latest');
    expect(channelToNpmTag('beta')).toBe('beta');
    expect(channelToNpmTag('dev')).toBe('dev');
  });

  it('normalizeUpdateChannel trims and lowercases', () => {
    expect(normalizeUpdateChannel(' STABLE ')).toBe('stable');
    expect(normalizeUpdateChannel('Beta')).toBe('beta');
    expect(normalizeUpdateChannel('x')).toBe(null);
    expect(normalizeUpdateChannel(null)).toBe(null);
  });

  it('isBetaVersion / isStableVersion', () => {
    expect(isBetaVersion('1.0.0-beta.1')).toBe(true);
    expect(isBetaVersion('1.0.0')).toBe(false);
    expect(isStableVersion('1.0.0')).toBe(true);
  });
});
