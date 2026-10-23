import { expect, it } from 'vitest';
import { phoneDependencyAsset } from '../phone-dependency-catalog.js';

it('pins official host-specific ADB packages and one portable Android scrcpy server', () => {
  for (const [platform, arch, suffix] of [['darwin', 'arm64', 'darwin'], ['darwin', 'x64', 'darwin'], ['linux', 'x64', 'linux'], ['win32', 'x64', 'win']] as const) {
    const asset = phoneDependencyAsset('adb', platform, arch)!;
    expect(asset.url).toBe(`https://dl.google.com/android/repository/platform-tools_r37.0.1-${suffix}.zip`);
    expect(asset.sha256).toMatch(/^[a-f0-9]{64}$/);
  }
  expect(phoneDependencyAsset('adb', 'linux', 'arm64')).toBeUndefined();
  expect(phoneDependencyAsset('scrcpy', 'linux', 'arm64')).toMatchObject({ archive: false, version: '3.3.3' });
});
