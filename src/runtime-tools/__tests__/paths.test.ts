import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runtimeDownloadPath, runtimeLockPath, runtimeStagingDir, runtimeVersionDir } from '../paths.js';

describe('runtime paths', () => {
  const stateDir = join(process.cwd(), '.test-state');

  it('keeps generated paths inside their runtime roots', () => {
    expect(runtimeVersionDir(stateDir, 'node', '22.23.2'))
      .toBe(join(stateDir, 'tools', 'node', 'versions', '22.23.2'));
    expect(runtimeLockPath(stateDir, 'uv', '0.8.11'))
      .toBe(runtimeLockPath(stateDir, 'uv', '0.8.12'));
  });

  it('rejects path traversal components', () => {
    expect(() => runtimeVersionDir(stateDir, 'node', '../../outside')).toThrow('Invalid runtime version');
    expect(() => runtimeDownloadPath(stateDir, '../outside')).toThrow('Invalid archive file');
    expect(() => runtimeStagingDir(stateDir, 'node', '../../outside', 'op')).toThrow('Invalid runtime staging directory');
  });
});
