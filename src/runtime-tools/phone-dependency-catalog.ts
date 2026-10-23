import { join } from 'node:path';

import { resolveStateDir } from '../config/paths-state.js';

export const ADB_VERSION = '37.0.1';
export const SCRCPY_VERSION = '3.3.3';
export const SCRCPY_SHA256 = '7e70323ba7f259649dd4acce97ac4fefbae8102b2c6d91e2e7be613fd5354be0';
export type PhoneDependencyKind = 'adb' | 'scrcpy';
export type PhoneDependencyAsset = { kind: PhoneDependencyKind; version: string; filename: string; url: string; sha256: string; archive: boolean };

/** Pinned official distributions, hashed from dl.google.com over HTTPS. */
const ADB_ASSETS = {
  darwin: { suffix: 'darwin', sha256: 'ee39ad5967e95c2a07f04dbcbde96b1a0c916ba376096db5d2f498b7727a5d1d' },
  linux: { suffix: 'linux', sha256: 'd230f13842f60f782a8645f9c813f8f845bf36089ea7289f28c48f17979313f1' },
  win32: { suffix: 'win', sha256: '45f4d63113e895ebde0c90f194099a4676b6ac653bd28d54314a9e022bbc1a99' },
} as const;

export function phoneDependencyAsset(kind: PhoneDependencyKind, platform: NodeJS.Platform = process.platform, arch = process.arch): PhoneDependencyAsset | undefined {
  if (kind === 'scrcpy') {
    const filename = `scrcpy-server-v${SCRCPY_VERSION}`;
    return { kind, version: SCRCPY_VERSION, filename, sha256: SCRCPY_SHA256, archive: false,
      url: `https://github.com/Genymobile/scrcpy/releases/download/v${SCRCPY_VERSION}/${filename}` };
  }
  if (!(platform === 'darwin' && ['arm64', 'x64'].includes(arch)) && !(['linux', 'win32'].includes(platform) && arch === 'x64')) return undefined;
  const asset = ADB_ASSETS[platform as keyof typeof ADB_ASSETS];
  const filename = `platform-tools_r${ADB_VERSION}-${asset.suffix}.zip`;
  return { kind, version: ADB_VERSION, filename, sha256: asset.sha256, archive: true,
    url: `https://dl.google.com/android/repository/${filename}` };
}

export const managedPhoneAdbDir = (stateDir = resolveStateDir()) => join(stateDir, 'tools', 'adb', 'versions', ADB_VERSION);
export const managedPhoneAdbPath = (stateDir = resolveStateDir()) => join(managedPhoneAdbDir(stateDir), process.platform === 'win32' ? 'adb.exe' : 'adb');
export const managedScrcpyServerPath = (stateDir = resolveStateDir()) => join(stateDir, 'tools', 'scrcpy', `scrcpy-server-v${SCRCPY_VERSION}`);
