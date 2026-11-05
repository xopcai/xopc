import { expect, it } from 'vitest';

import { installedApplicationPids, installedBundleProcesses, packagedAcceptanceEnvironment } from '../electron-packaged-acceptance.mjs';

it('removes developer resource mappings while preserving isolated state and the normal certificate trust chain', () => {
  const env = packagedAcceptanceEnvironment({ XOPC_UI_STATIC_ROOT: '/repo/dist', XOPC_SQLITE_ASSET_ROOT: '/repo/src',
    XOPC_TEMPLATE_PATH: '/repo/templates', NODE_PATH: '/repo/node_modules', NODE_OPTIONS: '--import tsx', ELECTRON_RUN_AS_NODE: '1',
    ELECTRON_RENDERER_URL: 'http://localhost:5173', XOPC_STATE_DIR: '/isolated', NODE_EXTRA_CA_CERTS: '/trusted/cert' });
  expect(env).toEqual({ XOPC_STATE_DIR: '/isolated', NODE_EXTRA_CA_CERTS: '/trusted/cert' });
});

it('detects orphaned helpers and bundled servers without matching neighboring or user applications', () => {
  const root = '/Users/test/Acceptance Apps/xopc.app';
  const rows = `10 ${root}/Contents/MacOS/xopc
11 ${root}/Contents/Frameworks/xopc Helper.app/Contents/MacOS/xopc Helper
12 ${root}/Contents/Resources/bin/voice-hotkey-helper
13 ${root}-other/Contents/MacOS/xopc
14 /Applications/xopc.app/Contents/MacOS/xopc
15 /private/tmp/Test.app/Contents/MacOS/xopc`;
  expect(installedBundleProcesses(rows, [root, '/private/tmp/Test.app']).map(row => row.pid)).toEqual([10, 11, 12, 15]);
});

it('tracks only the exact installed executable outside tmp and excludes external Gateway owners', () => {
  const executable = '/Users/test/Acceptance Apps/xopc.app/Contents/MacOS/xopc';
  const rows = `12 ${executable}
13 ${executable} /Users/test/out/server/index.js gateway
14 /Applications/xopc.app/Contents/MacOS/xopc
15 /bin/zsh -c ${executable}
16 ${executable}-other
17 ${executable}
invalid`;
  expect(installedApplicationPids(rows, [executable])).toEqual([12, 17]);
});
