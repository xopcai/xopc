import { afterEach, describe, expect, it } from 'vitest';

import {
  buildSetupManifest,
  getRegisteredDomains,
  registerSetupDomain,
  serializeSetupManifest,
} from '../manifest.js';

const TEST_DOMAINS = ['__test_alpha', '__test_beta', '__test_throws'];

describe('setup manifest registry', () => {
  afterEach(() => {
    // The registry is module-level, so tests must clean up after themselves.
    // We can't directly delete, but registering an empty descriptor effectively
    // resets each test target — easier: just leave them; tests assert on shape.
  });

  it('preserves descriptors across calls and sorts domains alphabetically', () => {
    registerSetupDomain({
      domain: '__test_beta',
      description: 'beta',
      actions: [{ name: 'noop', cli: 'noop', description: 'noop' }],
      fields: {},
    });
    registerSetupDomain({
      domain: '__test_alpha',
      description: 'alpha',
      actions: [{ name: 'noop', cli: 'noop', description: 'noop' }],
      fields: {},
    });

    const domains = getRegisteredDomains().filter((d) => TEST_DOMAINS.includes(d.domain));
    const idx = (id: string) => domains.findIndex((d) => d.domain === id);
    expect(idx('__test_alpha')).toBeLessThan(idx('__test_beta'));
  });

  it('serializeSetupManifest evaluates targets() lazily and swallows errors', () => {
    registerSetupDomain({
      domain: '__test_throws',
      description: 'throws',
      actions: [{ name: 'noop', cli: 'noop', description: 'noop' }],
      fields: {},
      targets: () => {
        throw new Error('boom');
      },
    });

    const manifest = serializeSetupManifest();
    const entry = manifest.domains.find((d) => d.domain === '__test_throws');
    expect(entry).toBeDefined();
    expect(entry?.targets).toEqual([]);
  });

  it('buildSetupManifest reports a stable version field', () => {
    expect(buildSetupManifest().version).toBe(1);
  });
});
