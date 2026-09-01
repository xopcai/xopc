import { describe, expect, it } from 'vitest';

import type { Config } from '../schema.js';
import { ConfigPersistenceError, persistConfigMutation } from '../config-mutation.js';

describe('persistConfigMutation', () => {
  it('keeps a successful mutation', async () => {
    const config = { mcp: { servers: {} } } as Config;
    await expect(persistConfigMutation({
      config,
      mutate: () => {
        config.mcp!.sessionIdleTtlMs = 123;
        return 'saved';
      },
      save: async () => ({ saved: true }),
    })).resolves.toBe('saved');
    expect(config.mcp?.sessionIdleTtlMs).toBe(123);
  });

  it('restores the full config when persistence fails', async () => {
    const config = { mcp: { servers: {} } } as Config;
    await expect(persistConfigMutation({
      config,
      mutate: () => {
        config.mcp!.servers!.temporary = { url: 'https://mcp.example.com/mcp' };
      },
      save: async () => ({ saved: false, error: 'disk full' }),
    })).rejects.toEqual(expect.objectContaining<Partial<ConfigPersistenceError>>({
      name: 'ConfigPersistenceError',
      message: 'disk full',
    }));
    expect(config).toEqual({ mcp: { servers: {} } });
  });

  it('restores the config when the mutation throws', async () => {
    const config = { mcp: { servers: {} } } as Config;
    await expect(persistConfigMutation({
      config,
      mutate: () => {
        config.mcp!.sessionIdleTtlMs = 456;
        throw new Error('mutation failed');
      },
      save: async () => ({ saved: true }),
    })).rejects.toThrow('mutation failed');
    expect(config).toEqual({ mcp: { servers: {} } });
  });

  it('wraps a thrown save error and restores the config', async () => {
    const config = { mcp: { servers: {} } } as Config;
    const operation = persistConfigMutation({
      config,
      mutate: () => {
        config.mcp!.sessionIdleTtlMs = 789;
      },
      save: async () => { throw new Error('storage unavailable'); },
    });

    await expect(operation).rejects.toBeInstanceOf(ConfigPersistenceError);
    await expect(operation).rejects.toThrow('storage unavailable');
    expect(config).toEqual({ mcp: { servers: {} } });
  });
});
