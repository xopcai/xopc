import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { collectPublishManifestErrors, PI_RUNTIME_PACKAGES } from '../check-publish-manifest.mjs';

function manifest() {
  return { dependencies: Object.fromEntries(PI_RUNTIME_PACKAGES.map((name) => [name, '1.1.0'])) };
}

describe('published Pi dependency constraints', () => {
  it('accepts a coherent exact runtime dependency set', () => {
    expect(collectPublishManifestErrors(manifest())).toEqual([]);
  });
  it.each(['@earendil-works/pi-codemode', '@earendil-works/pi-mcp', '@earendil-works/chord'])(
    'rejects a missing direct pin for %s even when a workspace lockfile would hide it', (name) => {
      const pkg = manifest();
      delete pkg.dependencies[name];
      expect(collectPublishManifestErrors(pkg).join('\n')).toContain(name);
    },
  );
  it.each(['^1.1.0', '1.2.0'])('rejects a drifting codemode constraint %s', (version) => {
    const pkg = manifest();
    pkg.dependencies['@earendil-works/pi-codemode'] = version;
    expect(collectPublishManifestErrors(pkg).join('\n')).toContain('pi-codemode');
  });
  it('rejects ranges even when every package uses the same range', () => {
    const pkg = manifest();
    for (const name of PI_RUNTIME_PACKAGES) pkg.dependencies[name] = '^1.1.0';
    expect(collectPublishManifestErrors(pkg).join('\n')).toContain('exact runtime version');
  });
  it('keeps the existing ban on runtime workspace dependencies', () => {
    const pkg = manifest();
    pkg.dependencies['private-package'] = 'workspace:*';
    expect(collectPublishManifestErrors(pkg).join('\n')).toContain('workspace:*');
  });
  it('guards the real publish manifest', () => {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
    expect(collectPublishManifestErrors(pkg)).toEqual([]);
  });
});
