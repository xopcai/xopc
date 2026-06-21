import { describe, expect, it, beforeEach } from 'vitest';

import { ExtensionApiImpl, createExtensionLogger } from '../api.ts';
import { ExtensionRegistryImpl } from '../loader.ts';
import { commandRegistry } from '../../chat-commands/registry.ts';
import type { Config } from '../../config/config-surface.ts';

const minimalConfig = { agents: {} } as Config;

function unregisterExtTestCommands(): void {
  for (const cmd of commandRegistry.list()) {
    if (cmd.id.startsWith('ext.ext-reg-test.')) {
      commandRegistry.unregister(cmd.id);
    }
  }
}

describe('ExtensionApiImpl registerCommand', () => {
  beforeEach(() => {
    unregisterExtTestCommands();
  });

  it('registers in commandRegistry with category extension', () => {
    const registry = new ExtensionRegistryImpl();
    const api = new ExtensionApiImpl(
      'ext-reg-test',
      'Test',
      '1',
      '/tmp',
      minimalConfig,
      {},
      createExtensionLogger('test'),
      (p) => p,
      registry,
      { commands: ['ping', 'cleanup-cmd'] },
    );

    api.registerCommand({
      name: 'ping',
      description: 'pong',
      handler: async () => ({ content: 'pong' }),
    });

    const def = commandRegistry.get('ext.ext-reg-test.ping');
    expect(def).toBeDefined();
    expect(def?.category).toBe('extension');
    expect(def?.name).toBe('ping');
  });

  it('_cleanup unregisters extension commands', () => {
    const registry = new ExtensionRegistryImpl();
    const api = new ExtensionApiImpl(
      'ext-reg-test',
      'Test',
      '1',
      '/tmp',
      minimalConfig,
      {},
      createExtensionLogger('test'),
      (p) => p,
      registry,
      { commands: ['ping', 'cleanup-cmd'] },
    );

    api.registerCommand({
      name: 'cleanup-cmd',
      description: 'x',
      handler: async () => ({ content: 'ok' }),
    });

    expect(commandRegistry.get('ext.ext-reg-test.cleanup-cmd')).toBeDefined();

    api._cleanup();

    expect(commandRegistry.get('ext.ext-reg-test.cleanup-cmd')).toBeUndefined();
  });
});
