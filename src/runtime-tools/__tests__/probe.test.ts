import { describe, expect, it } from 'vitest';

import {
  normalizeRuntimeVersionRequest,
  parseRuntimeVersion,
  resolveInstallVersion,
  versionSatisfies,
} from '../probe.js';

describe('runtime version probes', () => {
  it('parses common runtime version output', () => {
    expect(parseRuntimeVersion('v22.23.2')).toBe('22.23.2');
    expect(parseRuntimeVersion('Python 3.12.11')).toBe('3.12.11');
  });

  it('supports exact, major, minor, and semver ranges', () => {
    expect(versionSatisfies('22.23.2', '22')).toBe(true);
    expect(versionSatisfies('3.12.11', '3.12')).toBe(true);
    expect(versionSatisfies('3.12.11', '3.13')).toBe(false);
    expect(versionSatisfies('22.23.2', '>=22 <23')).toBe(true);
  });

  it('rejects unsafe versions and resolves supported ranges to a catalog version', () => {
    expect(normalizeRuntimeVersionRequest('../../tmp')).toBeNull();
    expect(normalizeRuntimeVersionRequest('>=22 <23')).toBe('>=22 <23');
    expect(resolveInstallVersion('22', '22.23.2')).toBe('22.23.2');
    expect(resolveInstallVersion('>=23', '22.23.2')).toBeNull();
  });
});
