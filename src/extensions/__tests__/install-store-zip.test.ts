import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import AdmZip from 'adm-zip';
import { describe, expect, it } from 'vitest';

import {
  installExtensionFromStoreZip,
  peekExtensionIdFromStoreZip,
  peekExtensionPackageJsonFromStoreZip,
} from '../install.js';
import {
  commitStagedExtensionInstall,
  finalizeStagedExtensionInstall,
  rollbackStagedExtensionInstall,
  stageExtensionStoreZip,
} from '../install-transaction.js';

function zipBuffer(files: Record<string, string | Buffer>): Buffer {
  const zip = new AdmZip();
  for (const [name, data] of Object.entries(files)) {
    zip.addFile(name, Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8'));
  }
  return zip.toBuffer();
}

describe('peekExtensionIdFromStoreZip', () => {
  it('reads manifest id at zip root', () => {
    const buf = zipBuffer({ 'xopc.extension.json': JSON.stringify({ id: 'root-ext' }) });
    expect(peekExtensionIdFromStoreZip(buf)).toBe('root-ext');
  });

  it('reads manifest under one folder', () => {
    const buf = zipBuffer({
      'pkg/xopc.extension.json': JSON.stringify({ id: 'nested-id' }),
    });
    expect(peekExtensionIdFromStoreZip(buf)).toBe('nested-id');
  });

  it('rejects id with path separators', () => {
    const buf = zipBuffer({ 'xopc.extension.json': JSON.stringify({ id: 'bad/id' }) });
    expect(peekExtensionIdFromStoreZip(buf)).toBeUndefined();
  });

  it('returns undefined for empty zip', () => {
    const buf = zipBuffer({});
    expect(peekExtensionIdFromStoreZip(buf)).toBeUndefined();
  });
});

describe('installExtensionFromStoreZip', () => {
  it('installs a minimal valid zip', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'xopc-ext-test-'));
    try {
      const buf = zipBuffer({
        'xopc.extension.json': JSON.stringify({
          id: 't-test-ext',
          main: 'index.js',
          engines: { xopc: '>=0.0.0' },
        }),
        'index.js': 'export default {};\n',
      });
      const res = await installExtensionFromStoreZip(buf, dir);
      expect(res.ok).toBe(true);
      expect(res.extensionId).toBe('t-test-ext');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects sibling paths outside single-folder extension root', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'xopc-ext-test-'));
    try {
      const buf = zipBuffer({
        'myext/xopc.extension.json': JSON.stringify({
          id: 'e',
          main: 'index.js',
          engines: { xopc: '>=0.0.0' },
        }),
        'other/readme.txt': 'x',
        'myext/index.js': 'export default {};\n',
      });
      const res = await installExtensionFromStoreZip(buf, dir);
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/Invalid zip/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('transactional store extension install', () => {
  it('smoke-checks before exposing the extension at its live path', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'xopc-ext-transaction-'));
    try {
      const buf = zipBuffer({
        'xopc.extension.json': JSON.stringify({
          id: 'transaction-test',
          main: 'index.js',
          engines: { xopc: '>=0.0.0' },
        }),
        'index.js': 'export default {}\n',
      });

      const staged = await stageExtensionStoreZip(buf, dir);
      expect(existsSync(join(dir, 'transaction-test'))).toBe(false);
      commitStagedExtensionInstall(staged, false);
      expect(existsSync(join(dir, 'transaction-test', 'index.js'))).toBe(true);
      finalizeStagedExtensionInstall(staged);
      expect(existsSync(staged.stagingRoot)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('restores the previous version when a committed overwrite is rolled back', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'xopc-ext-transaction-'));
    const liveDir = join(dir, 'transaction-test');
    try {
      mkdirSync(liveDir);
      writeFileSync(join(liveDir, 'marker.txt'), 'old');
      const buf = zipBuffer({
        'xopc.extension.json': JSON.stringify({
          id: 'transaction-test',
          main: 'index.js',
          engines: { xopc: '>=0.0.0' },
        }),
        'index.js': 'export default { version: "new" }\n',
      });

      const staged = await stageExtensionStoreZip(buf, dir);
      commitStagedExtensionInstall(staged, true);
      expect(existsSync(join(liveDir, 'marker.txt'))).toBe(false);
      rollbackStagedExtensionInstall(staged);
      expect(readFileSync(join(liveDir, 'marker.txt'), 'utf8')).toBe('old');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects a main module with unresolved runtime imports without touching the live path', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'xopc-ext-transaction-'));
    try {
      const buf = zipBuffer({
        'xopc.extension.json': JSON.stringify({
          id: 'broken-runtime',
          main: 'index.js',
          engines: { xopc: '>=0.0.0' },
        }),
        'index.js': 'import "./missing-runtime.js"; export default {}\n',
      });

      await expect(stageExtensionStoreZip(buf, dir)).rejects.toThrow(/missing-runtime/);
      expect(existsSync(join(dir, 'broken-runtime'))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reads package metadata from the extension manifest root', () => {
    const buf = zipBuffer({
      'pkg/xopc.extension.json': JSON.stringify({ id: 'nested-id' }),
      'pkg/package.json': JSON.stringify({
        dependencies: { example: '1.0.0' },
        scripts: { postinstall: 'node setup.js' },
      }),
    });
    expect(peekExtensionPackageJsonFromStoreZip(buf)).toMatchObject({
      dependencies: { example: '1.0.0' },
      scripts: { postinstall: 'node setup.js' },
    });
  });
});
