import { describe, expect, it } from 'vitest';

import { resolveCliCommandPath } from '../argv.js';
import { resolveCliCatalogCommandPath, resolveCliCommandPathPolicy } from '../command-path-policy.js';
import {
  shouldEagerLoadGatewaySubcommands,
  shouldLoadExtensionCliForCommandPath,
} from '../command-startup-policy.js';

describe('command startup policy', () => {
  it('skips extension CLI for gateway management commands', () => {
    expect(shouldLoadExtensionCliForCommandPath(['gateway', 'status'])).toBe(false);
    expect(shouldLoadExtensionCliForCommandPath(['config'])).toBe(false);
  });

  it('loads extension CLI for extensions and channels commands', () => {
    expect(shouldLoadExtensionCliForCommandPath(['extensions'])).toBe(true);
    expect(shouldLoadExtensionCliForCommandPath(['channels'])).toBe(true);
  });

  it('uses lazy gateway subcommands for foreground gateway run', () => {
    expect(shouldEagerLoadGatewaySubcommands(['gateway'])).toBe(false);
    expect(resolveCliCommandPathPolicy(['gateway']).gatewaySubcommands).toBe('lazy');
  });

  it('resolves nested command paths', () => {
    expect(resolveCliCommandPath(['node', 'xopc', 'gateway', 'status'])).toEqual(['gateway', 'status']);
    expect(resolveCliCatalogCommandPath(['node', 'xopc', 'gateway', 'status'])).toEqual([
      'gateway',
      'status',
    ]);
  });
});
