import { describe, expect, it, vi } from 'vitest';

import { RuntimeToolsConfigSchema } from '../../config/schema.js';
import { provisionEagerRuntimes } from '../bootstrap.js';

describe('runtime bootstrap', () => {
  it('provisions only runtimes configured as eager and keeps failures isolated', async () => {
    const resolve = vi.fn(async ({ runtime }: { runtime: 'node' | 'uv' | 'python' }) => {
      if (runtime === 'python') throw new Error('offline');
      return {
        runtime,
        version: '1.0.0',
        source: 'managed' as const,
        executable: `/tools/${runtime}`,
        executables: { primary: `/tools/${runtime}` },
      };
    });
    const config = RuntimeToolsConfigSchema.parse({
      node: { provision: 'eager' },
      python: { provision: 'eager' },
    });

    const results = await provisionEagerRuntimes({
      stateDir: '/tmp/xopc-runtime-bootstrap',
      config,
      manager: { resolve },
    });

    expect(resolve).toHaveBeenCalledTimes(2);
    expect(results).toEqual([
      expect.objectContaining({ runtime: 'node', ok: true }),
      expect.objectContaining({ runtime: 'python', ok: false, error: 'offline' }),
    ]);
  });
});
