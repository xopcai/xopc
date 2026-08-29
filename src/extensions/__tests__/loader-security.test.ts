import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { ExtensionLoader } from '../loader.js';
import type { ResolvedExtensionConfig } from '../types/index.js';

const tempDirs: string[] = [];

function createExtension(): ResolvedExtensionConfig {
  const path = mkdtempSync(join(tmpdir(), 'xopc-loader-security-'));
  tempDirs.push(path);
  writeFileSync(join(path, 'index.mjs'), 'export default () => {};\n');
  writeFileSync(join(path, 'xopc.extension.json'), JSON.stringify({
    id: 'third-party-test',
    name: 'Third Party Test',
    version: '1.0.0',
    kind: 'utility',
    main: 'index.mjs',
    engines: { xopc: '>=0.0.0' },
  }));
  return {
    id: 'third-party-test',
    name: 'Third Party Test',
    path,
    enabled: true,
    config: {},
    source: 'global',
  };
}

afterEach(() => {
  for (const path of tempDirs.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

describe('ExtensionLoader security policy', () => {
  it('blocks a safely-owned non-bundled extension unless it is trusted', async () => {
    const extension = createExtension();
    const blockedLoader = new ExtensionLoader({
      workspaceDir: extension.path,
      extensionsDir: extension.path,
    });
    blockedLoader.setSecurityConfig({ allowUntrusted: false, allow: [] });

    await expect(blockedLoader.loadExtension(extension)).resolves.toBeNull();

    const trustedLoader = new ExtensionLoader({
      workspaceDir: extension.path,
      extensionsDir: extension.path,
    });
    trustedLoader.setSecurityConfig({
      allowUntrusted: false,
      allow: [extension.id],
    });

    await expect(trustedLoader.loadExtension(extension)).resolves.not.toBeNull();

    trustedLoader.setSecurityConfig({ allowUntrusted: false, allow: [] });
    await expect(trustedLoader.loadExtension(extension)).resolves.toBeNull();
  });

  it.skipIf(process.platform === 'win32')(
    'blocks an unsafe extension path even when its id is trusted',
    async () => {
      const extension = createExtension();
      chmodSync(extension.path, 0o777);
      const loader = new ExtensionLoader({
        workspaceDir: extension.path,
        extensionsDir: extension.path,
      });
      loader.setSecurityConfig({ allow: [extension.id] });

      await expect(loader.loadExtension(extension)).resolves.toBeNull();
    },
  );
});
