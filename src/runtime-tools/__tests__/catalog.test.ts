import { describe, expect, it } from 'vitest';

import { detectRuntimePlatform, resolveRuntimeAsset } from '../catalog.js';

describe('runtime catalog', () => {
  it('maps supported host triples', () => {
    expect(detectRuntimePlatform('darwin', 'arm64')).toBe('darwin-arm64');
    expect(detectRuntimePlatform('win32', 'x64')).toBe('win32-x64');
    expect(detectRuntimePlatform('freebsd', 'x64')).toBeNull();
  });

  it('builds pinned Node distribution URLs', () => {
    expect(resolveRuntimeAsset({
      runtime: 'node',
      version: '22.23.2',
      platform: 'darwin-arm64',
    })).toMatchObject({
      archiveFile: 'node-v22.23.2-darwin-arm64.tar.gz',
      url: 'https://nodejs.org/download/release/v22.23.2/node-v22.23.2-darwin-arm64.tar.gz',
      archiveType: 'tar.gz',
    });
  });

  it('builds uv Windows assets', () => {
    expect(resolveRuntimeAsset({
      runtime: 'uv',
      version: '0.8.12',
      platform: 'win32-x64',
    })).toMatchObject({
      archiveFile: 'uv-x86_64-pc-windows-msvc.zip',
      archiveType: 'zip',
    });
  });
});
