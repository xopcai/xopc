import { accessSync, chmodSync, constants, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { load } from 'js-yaml';
import { afterEach, describe, expect, it } from 'vitest';

import { stageComputerDriver } from '../prepare-electron-pack-dir.mjs';

const roots: string[] = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'xopc-driver-pack-test-'));
  roots.push(root);
  return { root, pack: join(root, 'pack') };
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe('packaged computer driver', () => {
  it.each(['arm64', 'x64'])('stages the universal macOS binary and license for %s', arch => {
    const { root, pack } = fixture();
    const source = join(root, '.cache/computer-driver/0.28.2/cua-driver');
    mkdirSync(join(source, '..'), { recursive: true });
    mkdirSync(join(root, 'electron/resources'), { recursive: true });
    writeFileSync(source, 'driver fixture');
    chmodSync(source, 0o755);
    writeFileSync(join(root, 'electron/resources/computer-driver-LICENSE.txt'), 'license fixture');
    stageComputerDriver(root, pack, { platform: 'darwin', arch });
    const staged = join(pack, '_pack-resources/computer-driver');
    expect(readFileSync(join(staged, 'cua-driver'), 'utf8')).toBe('driver fixture');
    accessSync(join(staged, 'cua-driver'), constants.X_OK);
    expect(readFileSync(join(staged, 'computer-driver-LICENSE.txt'), 'utf8')).toBe('license fixture');
  });

  it('fails macOS packaging when the driver is missing', () => {
    const { root, pack } = fixture();
    expect(() => stageComputerDriver(root, pack, { platform: 'darwin', arch: 'arm64' })).toThrow('setup-computer-driver.mjs');
  });

  it.each(['win32', 'linux'])('does not ship a macOS driver for %s', platform => {
    const { root, pack } = fixture();
    stageComputerDriver(root, pack, { platform, arch: 'x64' });
    expect(existsSync(join(pack, '_pack-resources/computer-driver'))).toBe(true);
    expect(existsSync(join(pack, '_pack-resources/computer-driver/cua-driver'))).toBe(false);
  });

  it('copies the driver outside app.asar into the runtime bin directory', () => {
    const config = load(readFileSync(new URL('../electron-builder.pack.yml', import.meta.url), 'utf8')) as { extraResources: Array<{ from: string; to: string; filter: string[] }> };
    expect(config.extraResources.find(resource => resource.from === '_pack-resources/computer-driver'))
      .toEqual({ from: '_pack-resources/computer-driver', to: 'bin', filter: ['cua-driver', 'computer-driver-LICENSE.txt'] });
  });
});
