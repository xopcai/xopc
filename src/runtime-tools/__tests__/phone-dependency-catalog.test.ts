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

it('pins standalone HarmonyOS tools to the supported host architecture and exposes no rolling latest download', () => {
  for (const kind of ['hdc', 'java', 'hoscrcpy'] as const) {
    for (const [platform, arch] of [['darwin', 'arm64'], ['darwin', 'x64'], ['win32', 'x64'], ['linux', 'x64']] as const) {
      const asset = phoneDependencyAsset(kind, platform, arch)!;
      expect(asset.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(asset.url).toMatch(/^https:\/\//);
      expect(asset.url).not.toContain('/latest/');
    }
  }
  expect(phoneDependencyAsset('hdc', 'linux', 'arm64')).toBeUndefined();
  expect(phoneDependencyAsset('java', 'linux', 'arm64')).toBeDefined();
});

it('uses only host-specific HDC and USB files with a combined size below 7 MB', () => {
  for (const [platform, arch] of [['darwin', 'arm64'], ['darwin', 'x64'], ['win32', 'x64'], ['linux', 'x64']] as const) {
    const asset = phoneDependencyAsset('hdc', platform, arch)!;
    expect(asset.archive).toBe(false);
    expect(asset.version).toBe('3.2.0c');
    expect(asset.files).toHaveLength(2);
    expect(asset.files!.reduce((sum, file) => sum + file.sizeBytes, 0)).toBeLessThan(7_000_000);
    for (const file of asset.files!) {
      expect(file.url).toContain('hdw2@2.3.10/toolchains/');
      expect(file.url).not.toMatch(/sdk|\.zip|\.tar/);
      expect(file.sha256).toMatch(/^[a-f0-9]{64}$/);
    }
  }
});
