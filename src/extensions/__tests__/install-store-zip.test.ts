import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import AdmZip from 'adm-zip';
import { describe, expect, it } from 'vitest';

import { installExtensionFromStoreZip, peekExtensionIdFromStoreZip } from '../install.js';

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
