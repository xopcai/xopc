import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { loadConfig, saveConfig } from '../loader.js';
import { runBootstrapMigrationsSync } from '../../migrations/runner.js';
import { ConfigSchema } from '../schema.js';

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

describe('retired assistant heartbeat configuration', () => {
  it.each([null, 'obsolete', { enabled: true, intervalMs: 'invalid', activeHours: { timezone: 'invalid' } },
    { target: 'telegram', targetChatId: 'agent:main:weixin:personal:direct:peer' }])(
    'loads old polling settings without validation crashes or restarting old work: %j', async (heartbeat) => {
      const directory = mkdtempSync(join(tmpdir(), 'xopc-retired-heartbeat-')); directories.push(directory);
      const path = join(directory, 'xopc.json');
      writeFileSync(path, JSON.stringify({ gateway: { port: 19876, heartbeat, auth: { mode: 'token', token: 'preserve-test-token' } } }));
      expect(() => runBootstrapMigrationsSync(path)).not.toThrow();
      const config = loadConfig(path);
      expect(config.gateway?.heartbeat).toBeUndefined();
      expect(config.gateway?.port).toBe(19876);
      expect(config.gateway?.auth?.token).toBe('preserve-test-token');
      await saveConfig(config, path);
      expect(JSON.parse(readFileSync(path, 'utf8')).gateway).not.toHaveProperty('heartbeat');
      expect(loadConfig(path).gateway?.port).toBe(19876);
    },
  );

  it('does not enable retired polling in a new installation', () => {
    expect(ConfigSchema.parse(undefined).gateway.heartbeat).toBeUndefined();
  });
});
