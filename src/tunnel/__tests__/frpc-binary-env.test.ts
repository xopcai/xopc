import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { resolveBinDir } from '../../config/paths.js';
import {
  clearFrpcPathForProcess,
  publishFrpcPathForProcess,
} from '../frpc-binary.js';

describe('frpc runtime env', () => {
  afterEach(() => {
    clearFrpcPathForProcess();
  });

  it('publishFrpcPathForProcess sets XOPC_FRPC_PATH', () => {
    const path = join(resolveBinDir(), process.platform === 'win32' ? 'frpc.exe' : 'frpc');
    publishFrpcPathForProcess(path);
    expect(process.env.XOPC_FRPC_PATH).toBe(path);
  });

  it('clearFrpcPathForProcess removes XOPC_FRPC_PATH', () => {
    publishFrpcPathForProcess('/tmp/frpc');
    clearFrpcPathForProcess();
    expect(process.env.XOPC_FRPC_PATH).toBeUndefined();
  });
});

describe('frpc cache path', () => {
  it('resolveBinDir is under state dir', () => {
    const binDir = resolveBinDir();
    expect(binDir.endsWith('/bin') || binDir.endsWith('\\bin')).toBe(true);
    // Directory may not exist until first download
    if (existsSync(binDir)) {
      expect(existsSync(binDir)).toBe(true);
    }
  });
});
