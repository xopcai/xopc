import { describe, expect, it } from 'vitest';

import { listCloakBrowserPlatforms } from '../providers/cloakbrowser.js';

describe('CloakBrowser platform manifest', () => {
  const platforms = listCloakBrowserPlatforms();

  it('lists the expected platform tags', () => {
    const tags = platforms.map((p) => p.tag).sort();
    expect(tags).toEqual(
      ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64', 'windows-x64'].sort(),
    );
  });

  it.each(platforms)('platform %s exposes core fields', (p) => {
    expect(p.chromiumVersion).toMatch(/^\d+\.\d+\.\d+/);
    expect(p.executableRelativePath).toBeTruthy();
    expect(['macos', 'windows']).toContain(p.fingerprintPlatform);
    // expectedSha256 may be empty (verification opt-out until populated), but
    // when present it must look like a valid hex digest.
    if (p.expectedSha256) {
      expect(p.expectedSha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});
