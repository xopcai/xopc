import { describe, expect, it } from 'vitest';

import { installFromNpm, validateNpmPackageSpec } from '../install.js';

describe('npm extension install security', () => {
  it.each([
    'example-extension',
    'example-extension@1.2.3',
    '@xopc/example-extension',
    '@xopc/example-extension@1.2.3-beta.1',
  ])('accepts registry package spec %s', (spec) => {
    expect(validateNpmPackageSpec(spec)).toMatchObject({ ok: true });
  });

  it.each([
    'example-extension; touch /tmp/xopc-injected',
    'example-extension && whoami',
    'example-extension@latest',
    'example-extension@^1.2.3',
    'https://registry.example.test/example-extension.tgz',
    'file:../example-extension',
    'npm:example-extension@1.2.3',
  ])('rejects non-registry or non-exact package spec %s', (spec) => {
    expect(validateNpmPackageSpec(spec)).toMatchObject({ ok: false });
  });

  it('rejects an injection payload before invoking npm', async () => {
    await expect(
      installFromNpm('example-extension; touch /tmp/xopc-injected', '/unused'),
    ).resolves.toMatchObject({ ok: false, error: expect.stringContaining('Invalid npm package spec') });
  });
});
