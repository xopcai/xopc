import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  ELECTRON_GATEWAY_EXTERNALS,
  ELECTRON_PACKAGED_DEPENDENCIES,
  buildMinimalElectronPackageJson,
} from '../../scripts/electron-runtime-externals.mjs';

describe('electron-runtime-externals', () => {
  it('packaged dependencies are gateway externals minus extraResources-only modules', () => {
    for (const name of ELECTRON_PACKAGED_DEPENDENCIES) {
      expect(ELECTRON_GATEWAY_EXTERNALS).toContain(name);
    }
    expect(ELECTRON_GATEWAY_EXTERNALS).toContain('playwright-core');
    expect(ELECTRON_PACKAGED_DEPENDENCIES).not.toContain('playwright-core');
  });

  it('buildMinimalElectronPackageJson keeps only runtime deps', () => {
    const rootPkg = {
      name: '@xopcai/xopc',
      version: '0.0.0',
      dependencies: {
        hono: '^4.0.0',
        'node-cron': '^4.2.1',
        'silk-wasm': '^3.7.1',
        '@vscode/ripgrep': '^1.18.0',
      },
      devDependencies: {
        vitest: '^4.0.0',
      },
    };

    const minimal = buildMinimalElectronPackageJson(rootPkg);
    expect(Object.keys(minimal.dependencies)).toEqual([
      '@vscode/ripgrep',
      'node-cron',
      'silk-wasm',
    ]);
    expect(minimal).not.toHaveProperty('devDependencies');
    expect(minimal.name).toBe('@xopcai/xopc');
  });

  it('unpacks packaged runtime deps beside the unpacked gateway server', () => {
    const packYml = readFileSync(join(process.cwd(), 'scripts/electron-builder.pack.yml'), 'utf8');

    for (const name of ELECTRON_PACKAGED_DEPENDENCIES) {
      expect(packYml).toContain(`node_modules/${name}/**`);
    }
  });

  it('unpacks bundled extensions together with dist/src imports', () => {
    const packYml = readFileSync(join(process.cwd(), 'scripts/electron-builder.pack.yml'), 'utf8');

    expect(packYml).toContain("'dist/extensions/**'");
    expect(packYml).toContain("'dist/src/**'");
    expect(packYml).toContain("'dist/_virtual/**'");
  });

  it('keeps packaged Electron locale names aligned with .pak files', () => {
    const packYml = readFileSync(join(process.cwd(), 'scripts/electron-builder.pack.yml'), 'utf8');
    const match = packYml.match(/^electronLanguages:\r?\n((?:  - .+\r?\n)+)/m);
    expect(match).not.toBeNull();
    const locales = match![1]!
      .split(/\r?\n/)
      .map((line) => line.match(/^\s+-\s+(.+?)\s*$/)?.[1])
      .filter((x): x is string => Boolean(x));

    expect(locales).toEqual(['en-US', 'zh-CN', 'zh-TW']);
    for (const locale of locales) {
      expect(existsSync(join(process.cwd(), 'node_modules/electron/dist/locales', `${locale}.pak`))).toBe(true);
    }
  });

  it('preserves electron devDependency for electron-builder version resolution', () => {
    const minimal = buildMinimalElectronPackageJson({
      name: 'x',
      version: '0.0.0',
      dependencies: {
        'node-cron': '^4.2.1',
        'silk-wasm': '^3.7.1',
        '@vscode/ripgrep': '^1.18.0',
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
