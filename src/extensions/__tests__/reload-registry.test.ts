import { describe, expect, it } from 'vitest';

import { ExtensionRegistryImpl } from '../loader.ts';

describe('ExtensionRegistryImpl reload registry', () => {
  it('addReloadRegistration replaces same extension id', () => {
    const reg = new ExtensionRegistryImpl();
    reg.addReloadRegistration({
      extensionId: 'a',
      handler: async () => ({ success: true }),
      configPrefixes: ['extensions.a'],
    });
    reg.addReloadRegistration({
      extensionId: 'a',
      handler: async () => ({ success: false, error: 'x' }),
      configPrefixes: ['extensions.a'],
    });
    expect(reg.getReloadRegistrations()).toHaveLength(1);
  });

  it('getMatchingReloadRegistrations respects prefixes', () => {
    const reg = new ExtensionRegistryImpl();
    reg.addReloadRegistration({
      extensionId: 'feishu',
      handler: async () => ({ success: true }),
      configPrefixes: ['extensions.feishu', 'channels.feishu'],
    });
    expect(reg.getMatchingReloadRegistrations(['extensions.feishu.token'])).toHaveLength(1);
    expect(reg.getMatchingReloadRegistrations(['channels.feishu.accounts'])).toHaveLength(1);
    expect(reg.getMatchingReloadRegistrations(['agents.defaults.models.chat'])).toHaveLength(0);
  });

  it('empty configPrefixes matches any changed path batch', () => {
    const reg = new ExtensionRegistryImpl();
    reg.addReloadRegistration({
      extensionId: 'x',
      handler: async () => ({ success: true }),
      configPrefixes: [],
    });
    expect(reg.getMatchingReloadRegistrations(['anything'])).toHaveLength(1);
  });

  it('removeReloadRegistration drops handler', () => {
    const reg = new ExtensionRegistryImpl();
    reg.addReloadRegistration({
      extensionId: 'z',
      handler: async () => ({ success: true }),
      configPrefixes: ['extensions.z'],
    });
    reg.removeReloadRegistration('z');
    expect(reg.getReloadRegistrations()).toHaveLength(0);
  });
});
