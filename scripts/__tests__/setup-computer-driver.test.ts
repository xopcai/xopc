import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe('computer driver download', () => {
  it.each([
    { github: 'ci-token', gh: 'cli-token', authorization: 'Bearer ci-token' },
    { github: '', gh: 'cli-token', authorization: 'Bearer cli-token' },
    { github: '', gh: '', authorization: undefined },
  ])('authenticates with the available token ($authorization)', ({ github, gh, authorization }) => {
    const root = mkdtempSync(join(tmpdir(), 'xopc-driver-download-test-'));
    roots.push(root);
    mkdirSync(join(root, 'scripts'));
    const script = join(root, 'scripts/setup-computer-driver.mjs');
    copyFileSync(new URL('../setup-computer-driver.mjs', import.meta.url), script);
    const preload = join(root, 'mock-fetch.mjs');
    writeFileSync(preload, `
      import assert from 'node:assert/strict';
      Object.defineProperty(process, 'platform', { value: 'darwin' });
      globalThis.fetch = async (url, options) => {
        assert.equal(url, 'https://api.github.com/repos/trycua/cua/releases/assets/566587560');
        assert.equal(options.headers.Accept, 'application/octet-stream');
        assert.equal(options.headers.Authorization, ${JSON.stringify(authorization)});
        console.log('Download request verified');
        return { ok: true, arrayBuffer: async () => new ArrayBuffer(0) };
      };
    `);
    const result = spawnSync(process.execPath, ['--import', preload, script], {
      encoding: 'utf8',
      env: { ...process.env, GITHUB_TOKEN: github, GH_TOKEN: gh },
    });
    expect(result.stdout).toContain('Download request verified');
    // Authentication must not bypass verification of the downloaded archive.
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Driver checksum mismatch');
  });

  it('retries transient download failures', () => {
    const root = mkdtempSync(join(tmpdir(), 'xopc-driver-retry-test-'));
    roots.push(root);
    mkdirSync(join(root, 'scripts'));
    const script = join(root, 'scripts/setup-computer-driver.mjs');
    copyFileSync(new URL('../setup-computer-driver.mjs', import.meta.url), script);
    const preload = join(root, 'mock-fetch.mjs');
    writeFileSync(preload, `
      Object.defineProperty(process, 'platform', { value: 'darwin' });
      globalThis.setTimeout = (callback) => { callback(); return 0; };
      let attempts = 0;
      globalThis.fetch = async () => {
        attempts += 1;
        console.log(\`Download attempt \${attempts}\`);
        if (attempts === 1) throw new TypeError('fetch failed');
        return { ok: true, arrayBuffer: async () => new ArrayBuffer(0) };
      };
    `);
    const result = spawnSync(process.execPath, ['--import', preload, script], {
      encoding: 'utf8',
      env: { ...process.env, GITHUB_TOKEN: '', GH_TOKEN: '' },
    });
    expect(result.stdout).toContain('Download attempt 1');
    expect(result.stdout).toContain('Download attempt 2');
    expect(result.stderr).toContain('Driver download attempt 1/4 failed');
    expect(result.stderr).toContain('Driver checksum mismatch');
  });

  it('does not retry permanent HTTP failures', () => {
    const root = mkdtempSync(join(tmpdir(), 'xopc-driver-http-test-'));
    roots.push(root);
    mkdirSync(join(root, 'scripts'));
    const script = join(root, 'scripts/setup-computer-driver.mjs');
    copyFileSync(new URL('../setup-computer-driver.mjs', import.meta.url), script);
    const preload = join(root, 'mock-fetch.mjs');
    writeFileSync(preload, `
      Object.defineProperty(process, 'platform', { value: 'darwin' });
      let attempts = 0;
      globalThis.fetch = async () => {
        attempts += 1;
        console.log(\`Download attempt \${attempts}\`);
        return { ok: false, status: 404 };
      };
    `);
    const result = spawnSync(process.execPath, ['--import', preload, script], {
      encoding: 'utf8',
      env: { ...process.env, GITHUB_TOKEN: '', GH_TOKEN: '' },
    });
    expect(result.stdout).toContain('Download attempt 1');
    expect(result.stdout).not.toContain('Download attempt 2');
    expect(result.stderr).toContain('Driver download failed: 404');
  });
});
