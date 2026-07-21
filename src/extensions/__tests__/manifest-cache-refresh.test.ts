import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { buildExtensionMetadataSnapshot } from '../extension-metadata-snapshot.js';
import { ExtensionLoader } from '../loader.js';

const root = join(tmpdir(), `xopc-extension-refresh-${process.pid}-${Date.now()}`);

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('ExtensionLoader manifest refresh', () => {
  it('drops the bootstrap snapshot and discovers extensions installed at runtime', () => {
    const extensionsDir = join(root, 'extensions');
    const options = { extensionsDir, workspaceExtensionsDir: join(root, 'workspace-extensions') };
    const loader = new ExtensionLoader(options);
    loader.setManifestSnapshot(buildExtensionMetadataSnapshot(options));

    const extensionRoot = join(extensionsDir, 'local-refresh-check');
    mkdirSync(join(extensionRoot, 'ui'), { recursive: true });
    writeFileSync(join(extensionRoot, 'index.js'), 'export default {};\n');
    writeFileSync(join(extensionRoot, 'ui', 'index.html'), '<!doctype html>');
    writeFileSync(join(extensionRoot, 'xopc.extension.json'), JSON.stringify({
      id: 'local-refresh-check',
      name: 'Refresh Check',
      version: '1.0.0',
      kind: 'utility',
      main: 'index.js',
      ui: { main: 'ui/index.html' },
      engines: { xopc: '>=0.0.0' },
    }));

    expect(loader.discoverExtensions().some((extension) => extension.id === 'local-refresh-check')).toBe(false);
    loader.invalidateManifestCache();
    expect(loader.discoverExtensions()).toContainEqual(
      expect.objectContaining({ id: 'local-refresh-check', path: extensionRoot }),
    );
  });
});
