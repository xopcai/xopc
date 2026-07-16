import { chmodSync, existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { downloadCodebaseMemoryBinary, resolveCodebaseMemoryBinary } from '../binary.js';

describe('resolveCodebaseMemoryBinary', () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it('prefers an explicit executable path', () => {
    const root = mkdtempSync(join(tmpdir(), 'xopc-cbm-'));
    roots.push(root);
    const binary = join(root, process.platform === 'win32' ? 'cbm.exe' : 'cbm');
    writeFileSync(binary, 'test');
    if (process.platform !== 'win32') chmodSync(binary, 0o755);

    expect(resolveCodebaseMemoryBinary(binary)).toBe(realpathSync(binary));
  });

  it('removes incomplete downloads and returns a useful failure', async () => {
    const root = mkdtempSync(join(tmpdir(), 'xopc-cbm-'));
    roots.push(root);
    const binary = join(root, process.platform === 'win32' ? 'cbm.exe' : 'cbm');
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 503 }));

    await expect(downloadCodebaseMemoryBinary(binary, { fetchImplementation })).rejects.toThrow(
      'GitHub Releases returned HTTP 503',
    );
    expect(existsSync(`${binary}.${process.pid}.part`)).toBe(false);
  });

  it('rejects an archive whose checksum does not match the release manifest', async () => {
    const root = mkdtempSync(join(tmpdir(), 'xopc-cbm-'));
    roots.push(root);
    const binary = join(root, process.platform === 'win32' ? 'cbm.exe' : 'cbm');
    const platform = process.platform === 'win32' ? 'windows' : process.platform;
    const architecture = process.arch === 'x64' ? 'amd64' : process.arch;
    const extension = platform === 'windows' ? 'zip' : 'tar.gz';
    const portable = platform === 'linux' ? '-portable' : '';
    const archiveName = `codebase-memory-mcp-${platform}-${architecture}${portable}.${extension}`;
    const fetchImplementation = vi.fn<typeof fetch>((input) => {
      if (String(input).endsWith('checksums.txt')) {
        return Promise.resolve(new Response(`${'0'.repeat(64)}  ${archiveName}\n`));
      }
      return Promise.resolve(new Response(new Uint8Array([1, 2, 3])));
    });

    await expect(downloadCodebaseMemoryBinary(binary, { fetchImplementation })).rejects.toThrow(
      `checksum mismatch for ${archiveName}`,
    );
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
    expect(existsSync(binary)).toBe(false);
  });

  it('requires a checksum manifest entry before extracting an archive', async () => {
    const root = mkdtempSync(join(tmpdir(), 'xopc-cbm-'));
    roots.push(root);
    const binary = join(root, process.platform === 'win32' ? 'cbm.exe' : 'cbm');
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(`${'0'.repeat(64)}  another-file.tar.gz\n`),
    );

    await expect(downloadCodebaseMemoryBinary(binary, { fetchImplementation })).rejects.toThrow(
      'checksums.txt does not contain codebase-memory-mcp-',
    );
    expect(fetchImplementation).toHaveBeenCalledOnce();
  });

  it('times out even when a network implementation ignores abort signals', async () => {
    const root = mkdtempSync(join(tmpdir(), 'xopc-cbm-'));
    roots.push(root);
    const binary = join(root, process.platform === 'win32' ? 'cbm.exe' : 'cbm');
    const fetchImplementation = vi.fn<typeof fetch>(() => new Promise<Response>(() => {}));

    await expect(
      downloadCodebaseMemoryBinary(binary, { fetchImplementation, timeoutMs: 10 }),
    ).rejects.toThrow('download timed out after 10ms');
  });
});
