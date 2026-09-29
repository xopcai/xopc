import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Command } from 'commander';
import { afterEach, describe, expect, it } from 'vitest';

import { AgentCatalogRepository } from '../../agent-catalog/repository.js';
import { closeXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../storage/sqlite/connection.js';
import { registerExtensionCliCommands } from '../extension-cli-register.js';

describe('extension CLI registration', () => {
  const previousArgv = process.argv;
  const previousStateDir = process.env.XOPC_STATE_DIR;
  const previousConfigPath = process.env.XOPC_CONFIG_PATH;
  let directory: string | undefined;

  afterEach(() => {
    process.argv = previousArgv;
    if (previousStateDir === undefined) delete process.env.XOPC_STATE_DIR;
    else process.env.XOPC_STATE_DIR = previousStateDir;
    if (previousConfigPath === undefined) delete process.env.XOPC_CONFIG_PATH;
    else process.env.XOPC_CONFIG_PATH = previousConfigPath;
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    if (directory) rmSync(directory, { recursive: true, force: true });
    directory = undefined;
  });

  it('bootstraps a fresh Agent catalog before loading extension config', async () => {
    directory = mkdtempSync(join(tmpdir(), 'xopc-extension-cli-'));
    process.env.XOPC_STATE_DIR = directory;
    process.env.XOPC_CONFIG_PATH = join(directory, 'xopc.json');
    process.argv = ['node', 'xopc', 'extensions', 'install', 'plugin.zip'];

    await expect(registerExtensionCliCommands(new Command())).resolves.toBeUndefined();
    expect(new AgentCatalogRepository().getSettings().defaultAgentId).toBe('main');
  });
});
