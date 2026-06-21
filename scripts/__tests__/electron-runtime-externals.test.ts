import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  ELECTRON_GATEWAY_EXTERNALS,
  ELECTRON_PACKAGED_DEPENDENCIES,
  buildMinimalElectronPackageJson,
  resolveInstalledPackageVersion,
} from '../../scripts/electron-runtime-externals.mjs';

describe('electron-runtime-externals', () => {
  it('keeps only unavoidable node_modules deps in packaged runtime', () => {
    expect(ELECTRON_PACKAGED_DEPENDENCIES).toEqual(['node-cron', 'silk-wasm']);
    expect(ELECTRON_GATEWAY_EXTERNALS).toContain('playwright-core');
    expect(ELECTRON_PACKAGED_DEPENDENCIES).not.toContain('playwright-core');
    expect(ELECTRON_PACKAGED_DEPENDENCIES).not.toContain('@larksuiteoapi/node-sdk');
    expect(ELECTRON_PACKAGED_DEPENDENCIES).not.toContain('ajv');
  });

  it('buildMinimalElectronPackageJson keeps only runtime deps', () => {
    const minimal = buildMinimalElectronPackageJson({
      name: '@xopcai/xopc',
      version: '0.0.0',
      dependencies: {
        hono: '^4.0.0',
        'node-cron': '^4.2.1',
        'silk-wasm': '^3.7.1',
      },
      devDependencies: {
        vitest: '^4.0.0',
      },
    });
    expect(Object.keys(minimal.dependencies)).toEqual(['node-cron', 'silk-wasm']);
    expect(minimal).not.toHaveProperty('devDependencies');
    expect(minimal.name).toBe('@xopcai/xopc');
  });

  it('pins packaged runtime deps to installed exact versions when repoRoot is provided', () => {
    const repoRoot = process.cwd();
    const minimal = buildMinimalElectronPackageJson(
      {
        name: '@xopcai/xopc',
        version: '0.0.0',
        dependencies: {
          'node-cron': '^4.2.1',
          'silk-wasm': '^3.7.1',
        },
      },
      repoRoot,
    );
    expect(minimal.dependencies).toEqual({
      'node-cron': resolveInstalledPackageVersion(repoRoot, 'node-cron'),
      'silk-wasm': resolveInstalledPackageVersion(repoRoot, 'silk-wasm'),
    });
    expect(Object.values(minimal.dependencies as Record<string, string>).every((v) => !v.startsWith('^'))).toBe(true);
  });

  it('unpacks minimal runtime deps and bundled extension bundles', () => {
    const packYml = readFileSync(join(process.cwd(), 'scripts/electron-builder.pack.yml'), 'utf8');
    expect(packYml).toContain("'node_modules/**'");
    expect(packYml).toContain("'dist/electron/extensions/**'");
    expect(packYml).not.toContain("'dist/extensions/**'");
    expect(packYml).not.toContain("'dist/src/**'");
  });

  it('enables production Electron fuses that do not break the gateway subprocess', () => {
    const packYml = readFileSync(join(process.cwd(), 'scripts/electron-builder.pack.yml'), 'utf8');
    expect(packYml).toContain('electronFuses:');
    expect(packYml).toContain('enableCookieEncryption: true');
    expect(packYml).toContain('enableNodeOptionsEnvironmentVariable: false');
    expect(packYml).toContain('enableNodeCliInspectArguments: false');
    expect(packYml).toContain('enableEmbeddedAsarIntegrityValidation: true');
    expect(packYml).toContain('onlyLoadAppFromAsar: true');
    expect(packYml).toContain('grantFileProtocolExtraPrivileges: false');
    expect(packYml).not.toContain('enableRunAsNode: false');
  });

  it('preserves electron devDependency for electron-builder version resolution', () => {
    const minimal = buildMinimalElectronPackageJson({
      name: 'x',
      version: '0.0.0',
      dependencies: {
        'node-cron': '^4.2.1',
        'silk-wasm': '^3.7.1',
      },
      devDependencies: {
        electron: '^41.7.1',
        vitest: '^4.0.0',
      },
    });
    expect(minimal.devDependencies).toEqual({ electron: '^41.7.1' });
  });

  it('throws when a packaged runtime dependency is missing from root package.json', () => {
    expect(() =>
      buildMinimalElectronPackageJson({
        name: 'x',
        version: '0.0.0',
        dependencies: { 'node-cron': '^4.2.1' },
      }),
    ).toThrow(/Missing root dependencies/);
  });
});
