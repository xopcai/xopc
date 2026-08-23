import { describe, expect, it } from 'vitest';

import { RuntimeToolsConfigSchema } from '../../config/schema.js';
import { resolveRuntimeAsset } from '../catalog.js';
import {
  canFallbackPythonInstall,
  runtimeGatewayPythonMirror,
  validateGatewayDescriptor,
} from '../download-source.js';

const asset = resolveRuntimeAsset({
  runtime: 'node',
  version: '22.23.2',
  platform: 'darwin-arm64',
});

describe('runtime download source', () => {
  it('rejects removed per-runtime mirror fields', () => {
    expect(RuntimeToolsConfigSchema.safeParse({
      download: { nodeMirror: 'https://legacy.example.com' },
    }).success).toBe(false);
  });

  it('builds the Python mirror URL without duplicate slashes', () => {
    expect(runtimeGatewayPythonMirror('https://xopc.ai/api/runtime/v1/')).toBe(
      'https://xopc.ai/api/runtime/v1/python-build-standalone',
    );
  });

  it('falls back for transport failures but not integrity failures', () => {
    expect(canFallbackPythonInstall('Request failed after 3 retries', false)).toBe(true);
    expect(canFallbackPythonInstall('checksum mismatch after failed to download', false)).toBe(false);
  });

  it('accepts an exact same-origin gateway descriptor', () => {
    expect(validateGatewayDescriptor({
      gatewayBaseUrl: 'https://xopc.ai/api/runtime/v1',
      asset,
      platform: 'darwin-arm64',
      value: {
        schemaVersion: 1,
        runtime: 'node',
        version: '22.23.2',
        platform: 'darwin-arm64',
        archive: {
          name: asset.archiveFile,
          archiveType: 'tar.gz',
          sha256: 'a'.repeat(64),
          url: `https://xopc.ai/api/runtime/v1/artifacts/node/22.23.2/darwin-arm64/${asset.archiveFile}`,
        },
      },
    })).toEqual(expect.objectContaining({ source: 'website', sha256: 'a'.repeat(64) }));
  });

  it('rejects artifact URLs outside the configured gateway', () => {
    expect(() => validateGatewayDescriptor({
      gatewayBaseUrl: 'https://xopc.ai/api/runtime/v1',
      asset,
      platform: 'darwin-arm64',
      value: {
        schemaVersion: 1,
        runtime: 'node',
        version: '22.23.2',
        platform: 'darwin-arm64',
        archive: {
          name: asset.archiveFile,
          archiveType: 'tar.gz',
          sha256: 'a'.repeat(64),
          url: `https://example.com/api/runtime/v1/artifacts/node/22.23.2/darwin-arm64/${asset.archiveFile}`,
        },
      },
    })).toThrow('untrusted artifact URL');
  });

  it('rejects descriptors with mismatched checksums or archive metadata', () => {
    expect(() => validateGatewayDescriptor({
      gatewayBaseUrl: 'https://xopc.ai/api/runtime/v1',
      asset,
      platform: 'darwin-arm64',
      value: {
        schemaVersion: 1,
        runtime: 'node',
        version: '22.23.2',
        platform: 'darwin-arm64',
        archive: {
          name: asset.archiveFile,
          archiveType: 'zip',
          sha256: 'invalid',
          url: `https://xopc.ai/api/runtime/v1/artifacts/node/22.23.2/darwin-arm64/${asset.archiveFile}`,
        },
      },
    })).toThrow('invalid descriptor');
  });
});
