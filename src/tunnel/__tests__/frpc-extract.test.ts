import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import AdmZip from 'adm-zip';
import { describe, expect, it } from 'vitest';

import {
  buildFrpcArchiveMemberPath,
  extractFrpcFromReleaseArchive,
  extractFrpcFromTarGzArchive,
  extractFrpcFromZipArchive,
  extractTarGzMemberNode,
  resolveExtractedMemberPath,
} from '../frpc-extract.js';

function writeTarField(header: Buffer, offset: number, value: string, length: number): void {
  header.write(value, offset, length, 'utf8');
}

function computeTarChecksum(header: Buffer): void {
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += header[i] ?? 0;
  const checksum = ` ${sum.toString(8).padStart(6, '0')}\0 `;
  header.write(checksum, 148, 8, 'ascii');
}

function buildTarGz(files: Array<{ path: string; content: Buffer }>): Buffer {
  const blocks: Buffer[] = [];
  for (const file of files) {
    const header = Buffer.alloc(512, 0);
    writeTarField(header, 0, file.path, 100);
    writeTarField(header, 124, file.content.length.toString(8).padStart(11, '0'), 12);
    header[156] = 0x30; // regular file
    writeTarField(header, 257, 'ustar', 6);
    writeTarField(header, 263, '00', 2);
    computeTarChecksum(header);
    blocks.push(header, file.content);
    const pad = (512 - (file.content.length % 512)) % 512;
    if (pad) blocks.push(Buffer.alloc(pad));
  }
  blocks.push(Buffer.alloc(512));
  return gzipSync(Buffer.concat(blocks));
}

describe('frpc-extract', () => {
  it('buildFrpcArchiveMemberPath uses .exe on Windows', () => {
    expect(buildFrpcArchiveMemberPath('frp_0.62.1_windows_amd64', 'win32')).toBe(
      'frp_0.62.1_windows_amd64/frpc.exe',
    );
    expect(buildFrpcArchiveMemberPath('frp_0.62.1_linux_amd64', 'linux')).toBe(
      'frp_0.62.1_linux_amd64/frpc',
    );
  });

  it('resolveExtractedMemberPath splits POSIX member paths on Windows', () => {
    const resolved = resolveExtractedMemberPath('C:\\tmp\\extract', 'folder/frpc.exe');
    expect(resolved).toBe(join('C:\\tmp\\extract', 'folder', 'frpc.exe'));
  });

  it('extractTarGzMemberNode extracts nested frpc binary', () => {
    const dir = mkdtempSync(join(tmpdir(), 'xopc-frpc-extract-test-'));
    const member = 'frp_0.62.1_darwin_arm64/frpc';
    const payload = Buffer.from('fake-frpc-binary');
    const archivePath = join(dir, 'frpc.tgz');
    const destPath = join(dir, 'frpc');
    writeFileSync(archivePath, buildTarGz([{ path: member, content: payload }]));

    extractTarGzMemberNode(archivePath, member, destPath);
    expect(readFileSync(destPath).equals(payload)).toBe(true);

    rmSync(dir, { recursive: true, force: true });
  });

  it('extractFrpcFromTarGzArchive falls back to Node tar parser', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'xopc-frpc-extract-archive-'));
    const folder = 'frp_0.62.1_linux_amd64';
    const member = buildFrpcArchiveMemberPath(folder, 'linux');
    const payload = Buffer.from('linux-frpc');
    const archivePath = join(dir, 'frpc.tgz');
    const destPath = join(dir, 'frpc');
    writeFileSync(archivePath, buildTarGz([{ path: member, content: payload }]));

    await extractFrpcFromTarGzArchive(archivePath, destPath, folder, 'linux');
    expect(readFileSync(destPath).equals(payload)).toBe(true);
    if (process.platform !== 'win32') chmodSync(destPath, 0o755);

    rmSync(dir, { recursive: true, force: true });
  });

  it('extractFrpcFromZipArchive extracts nested frpc.exe', () => {
    const dir = mkdtempSync(join(tmpdir(), 'xopc-frpc-extract-zip-'));
    const folder = 'frp_0.62.1_windows_amd64';
    const member = buildFrpcArchiveMemberPath(folder, 'win32');
    const payload = Buffer.from('windows-frpc');
    const archivePath = join(dir, 'frpc.zip');
    const destPath = join(dir, 'frpc.exe');
    const zip = new AdmZip();
    zip.addFile(member, payload);
    zip.writeZip(archivePath);

    extractFrpcFromZipArchive(archivePath, destPath, folder, 'win32');
    expect(readFileSync(destPath).equals(payload)).toBe(true);

    rmSync(dir, { recursive: true, force: true });
  });

  it('extractFrpcFromReleaseArchive routes zip archives', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'xopc-frpc-extract-release-'));
    const folder = 'frp_0.62.1_windows_amd64';
    const member = buildFrpcArchiveMemberPath(folder, 'win32');
    const payload = Buffer.from('release-frpc');
    const archivePath = join(dir, 'frpc.zip');
    const destPath = join(dir, 'frpc.exe');
    const zip = new AdmZip();
    zip.addFile(member, payload);
    zip.writeZip(archivePath);

    await extractFrpcFromReleaseArchive(archivePath, destPath, folder, 'win32');
    expect(readFileSync(destPath).equals(payload)).toBe(true);

    rmSync(dir, { recursive: true, force: true });
  });
});
