import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { load } from 'js-yaml';

describe('Windows signing readiness build configuration', () => {
  it('never falls back to a PFX when unconfigured Foundation signing is requested', () => {
    const result = spawnSync(process.execPath, ['scripts/electron-builder.mjs', '--win', '--x64'], {
      cwd: fileURLToPath(new URL('../..', import.meta.url)), encoding: 'utf8',
      env: { ...process.env, XOPC_WINDOWS_SIGNING_PROVIDER: 'signpath', WIN_CSC_LINK: 'not-a-real-certificate' }, timeout: 30_000,
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('no PFX fallback');
    expect(result.stdout).not.toContain('Staged');
  });
  it('offers to launch xopc from the assisted per-user installer and retains the privacy document', () => {
    const config = load(readFileSync(new URL('../electron-builder.pack.yml', import.meta.url), 'utf8')) as any;
    expect(config.nsis).toMatchObject({ oneClick: false, perMachine: false, allowElevation: false, runAfterFinish: true });
    expect(config.extraResources).toContainEqual({ from: '_pack-resources/compliance', to: 'compliance', filter: ['**/*'] });
  });
});
