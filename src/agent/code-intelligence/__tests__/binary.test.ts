import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  downloadCodebaseMemoryBinary,
  ensureCodebaseMemoryBinary,
  resolveCodebaseMemoryBinary,
} from '../binary.js';

describe('resolveCodebaseMemoryBinary', () => {
  const roots: string[] = [];
  const originalStateDir = process.env.XOPC_STATE_DIR;
  const originalBundledPath = process.env.XOPC_CBM_BUNDLED_PATH;
  const originalBundledManifestPath = process.env.XOPC_CBM_BUNDLED_MANIFEST_PATH;

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
    if (originalStateDir === undefined) delete process.env.XOPC_STATE_DIR;
    else process.env.XOPC_STATE_DIR = originalStateDir;
    if (originalBundledPath === undefined) delete process.env.XOPC_CBM_BUNDLED_PATH;
    else process.env.XOPC_CBM_BUNDLED_PATH = originalBundledPath;
    if (originalBundledManifestPath === undefined) delete process.env.XOPC_CBM_BUNDLED_MANIFEST_PATH;
    else process.env.XOPC_CBM_BUNDLED_MANIFEST_PATH = originalBundledManifestPath;
  });

  it('prefers an explicit executable path', () => {
    const root = mkdtempSync(join(tmpdir(), 'xopc-cbm-'));
    roots.push(root);
    const binary = join(root, process.platform === 'win32' ? 'cbm.exe' : 'cbm');
    writeFileSync(binary, 'test');
    if (process.platform !== 'win32') chmodSync(binary, 0o755);

    expect(resolveCodebaseMemoryBinary(binary)).toBe(realpathSync(binary));
  });

  it('seeds and reuses the versioned shared cache from a verified Electron binary', async () => {
    const root = mkdtempSync(join(tmpdir(), 'xopc-cbm-'));
    roots.push(root);
    const binaryName = process.platform === 'win32' ? 'codebase-memory-mcp.exe' : 'codebase-memory-mcp';
    const bundledPath = join(root, 'electron', binaryName);
    const binaryContents = 'verified bundled binary';
    mkdirSync(dirname(bundledPath), { recursive: true });
    writeFileSync(bundledPath, binaryContents);
    if (process.platform !== 'win32') chmodSync(bundledPath, 0o755);
    const platform = process.platform === 'win32' ? 'windows' : process.platform;
    const arch = process.arch === 'x64' ? 'amd64' : process.arch;
    const hash = createHash('sha256').update(binaryContents).digest('hex');
    const bundledManifestPath = join(root, 'electron', 'codebase-memory-mcp.manifest.json');
    writeFileSync(
      bundledManifestPath,
      JSON.stringify({ cbmVersion: '0.9.0', platform, arch, binarySha256: hash }),
    );
    process.env.XOPC_STATE_DIR = join(root, 'state');
    process.env.XOPC_CBM_BUNDLED_PATH = bundledPath;
    process.env.XOPC_CBM_BUNDLED_MANIFEST_PATH = bundledManifestPath;

    const installed = await ensureCodebaseMemoryBinary();
    expect(installed).toBe(
      realpathSync(
        join(root, 'state', 'bin', 'codebase-memory-mcp', 'v0.9.0', `${platform}-${arch}`, binaryName),
      ),
    );
    expect(readFileSync(installed, 'utf8')).toBe(binaryContents);
    expect(JSON.parse(readFileSync(join(dirname(installed), 'manifest.json'), 'utf8'))).toMatchObject({
      source: 'electron-bundle',
      binarySha256: hash,
    });

    rmSync(bundledPath, { force: true });
    delete process.env.XOPC_CBM_BUNDLED_PATH;
    delete process.env.XOPC_CBM_BUNDLED_MANIFEST_PATH;
    await expect(ensureCodebaseMemoryBinary()).resolves.toBe(installed);
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
