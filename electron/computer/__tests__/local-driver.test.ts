import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveLocalComputerDriver } from '../local-driver.js';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function candidate() {
  const root = mkdtempSync(join(tmpdir(), 'xopc-local-native-')); roots.push(root);
  const local = join(root, '.cache/computer-driver/local');
  const bytes = Buffer.from('candidate fixture; never executed');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const binary = `${sha256}/cua-driver`; mkdirSync(join(local, sha256), { recursive: true });
  writeFileSync(join(local, binary), bytes);
  const manifest = { version: 1, sdkVersion: '0.36.0', platform: 'darwin', arch: 'arm64',
    sha256, binary, sourceRevision: 'a'.repeat(40), sourceDirty: true };
  const save = () => writeFileSync(join(local, 'current.json'), JSON.stringify(manifest)); save();
  return { root, manifest, save, binary: join(local, binary) };
}
describe('local native candidate integrity', () => {
  it('loads only a matching platform candidate whose bytes match its manifest', () => {
    const f = candidate();
    expect(resolveLocalComputerDriver(f.root, 'darwin', 'arm64')).toBe(realpathSync(f.binary));
    expect(() => resolveLocalComputerDriver(f.root, 'darwin', 'x64')).toThrow('PLATFORM_MISMATCH');
    writeFileSync(f.binary, 'modified');
    expect(() => resolveLocalComputerDriver(f.root, 'darwin', 'arm64')).toThrow('CHECKSUM_MISMATCH');
  });
  it('refuses manifests that attempt to select an arbitrary executable', () => {
    const f = candidate(); f.manifest.binary = '../../outside'; f.save();
    expect(() => resolveLocalComputerDriver(f.root, 'darwin', 'arm64')).toThrow();
  });
});
