import { expect, it } from 'vitest';

import { packagedAcceptanceEnvironment } from '../electron-packaged-acceptance.mjs';

it('removes developer resource mappings while preserving isolated state and the normal certificate trust chain', () => {
  const env = packagedAcceptanceEnvironment({ XOPC_UI_STATIC_ROOT: '/repo/dist', XOPC_SQLITE_ASSET_ROOT: '/repo/src',
    XOPC_TEMPLATE_PATH: '/repo/templates', NODE_PATH: '/repo/node_modules', NODE_OPTIONS: '--import tsx', ELECTRON_RUN_AS_NODE: '1',
    ELECTRON_RENDERER_URL: 'http://localhost:5173', XOPC_STATE_DIR: '/isolated', NODE_EXTRA_CA_CERTS: '/trusted/cert' });
  expect(env).toEqual({ XOPC_STATE_DIR: '/isolated', NODE_EXTRA_CA_CERTS: '/trusted/cert' });
});
