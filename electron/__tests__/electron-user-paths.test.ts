import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name === 'userData') return join('electron', 'user-data');
      return name;
    },
  },
}));

import { ConfigSchema } from '../../src/config/schema.js';

import { getElectronUserPaths, resolveElectronFileIpcRoots } from '../ensure-gateway-config.js';

const originalStateDir = process.env.XOPC_STATE_DIR;
const originalConfigPath = process.env.XOPC_CONFIG_PATH;

afterEach(() => {
  if (originalStateDir === undefined) {
    delete process.env.XOPC_STATE_DIR;
  } else {
    process.env.XOPC_STATE_DIR = originalStateDir;
  }
  if (originalConfigPath === undefined) {
    delete process.env.XOPC_CONFIG_PATH;
  } else {
    process.env.XOPC_CONFIG_PATH = originalConfigPath;
  }
});

describe('getElectronUserPaths', () => {
  it('uses shared xopc state for config and workspace while keeping Electron userData separate', () => {
    process.env.XOPC_STATE_DIR = join('home', '.xopc');
    process.env.XOPC_CONFIG_PATH = join('home', '.xopc', 'xopc.json');

    expect(getElectronUserPaths()).toEqual({
      stateDir: join('home', '.xopc'),
      electronUserData: join('electron', 'user-data'),
      configPath: join('home', '.xopc', 'xopc.json'),
      workspacePath: join('home', '.xopc', 'workspace', 'main'),
    });
  });
});

describe('resolveElectronFileIpcRoots', () => {
  it('does not expose the entire shared state directory to file IPC', () => {
    const stateDir = resolve(join('home', '.xopc'));
    const paths = {
      stateDir,
      electronUserData: resolve(join('electron', 'user-data')),
      configPath: join(stateDir, 'xopc.json'),
      workspacePath: join(stateDir, 'workspace', 'main'),
    };
    process.env.XOPC_STATE_DIR = stateDir;
    const config = ConfigSchema.parse({
      agents: {
        default: 'main',
        list: [
          {
            id: 'main',
            identity: { name: 'Main', role: 'Agent', language: 'en', tone: 'direct' },
            responsibilities: { primary: ['Help the user complete tasks'] },
            workspace: { root: paths.workspacePath },
          },
        ],
      },
    });

    expect(resolveElectronFileIpcRoots(config, paths)).toEqual([
      paths.electronUserData,
      paths.workspacePath,
      join(stateDir, 'agents', 'main', 'profile'),
    ]);
  });
});
