import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../infra/write-file-atomic.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../infra/write-file-atomic.js')>();
  return { ...original, writeTextAtomicSync: vi.fn(original.writeTextAtomicSync) };
});

import { writeTextAtomicSync } from '../../infra/write-file-atomic.js';
import { AgentCatalogRepository } from '../../agent-catalog/repository.js';
import { closeXopcDatabase, openXopcDatabase } from '../../storage/sqlite/index.js';
import { readConfigFileSnapshot } from '../config-file.js';
import { loadConfig } from '../loader.js';
import { ConfigSchema } from '../schema.js';

const directories: string[] = [];
const settings = {
  gateway: { port: 18791, auth: { mode: 'token', token: 'upgrade-test-token' } },
  mcp: { servers: { example: { command: 'example-server' } } },
};

function configFile(value: unknown): string {
  const directory = mkdtempSync(join(tmpdir(), 'xopc-config-upgrade-'));
  directories.push(directory);
  const path = join(directory, 'xopc.json');
  writeFileSync(path, `${JSON.stringify(value)}\n`);
  return path;
}

beforeEach(() => {
  closeXopcDatabase();
  openXopcDatabase({ path: ':memory:' });
  new AgentCatalogRepository().ensureInitialized();
});

afterEach(() => {
  closeXopcDatabase();
  vi.clearAllMocks();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('existing configuration after Workflow removal', () => {
  it.each([{}, { enabled: true, allowlist: ['old-flow'] }, null])(
    'loads and removes retired Workflow settings without changing current values (%j)', (workflows) => {
      const path = configFile({ ...settings, workflows });
      const config = loadConfig(path);
      expect(config.gateway.auth.token).toBe(settings.gateway.auth.token);
      expect(config.gateway.port).toBe(settings.gateway.port);
      expect(config.mcp?.servers?.example.command).toBe('example-server');
      expect(config).not.toHaveProperty('workflows');
      expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(settings);
      loadConfig(path);
      expect(writeTextAtomicSync).toHaveBeenCalledTimes(1);
    },
  );

  it('keeps new config writes strict and does not hide unknown keys', () => {
    expect(ConfigSchema.safeParse({ ...settings, workflows: {} }).success).toBe(false);
    const path = configFile({ ...settings, workflows: {}, unknownSetting: true });
    const original = readFileSync(path, 'utf8');
    expect(() => readConfigFileSnapshot(path)).toThrow();
    expect(readFileSync(path, 'utf8')).toBe(original);
    expect(writeTextAtomicSync).not.toHaveBeenCalled();
  });

  it('does not modify a config that fails current channel validation', () => {
    const path = configFile({ ...settings, workflows: {}, channels: { missing: { enabled: true } } });
    const original = readFileSync(path, 'utf8');
    expect(() => loadConfig(path)).toThrow('Channel configuration failed validation');
    expect(readFileSync(path, 'utf8')).toBe(original);
    expect(writeTextAtomicSync).not.toHaveBeenCalled();
  });

  it('does not overwrite an edit made after the file was read', () => {
    const path = configFile({ ...settings, workflows: {} });
    const snapshot = readConfigFileSnapshot(path);
    const edited = `${JSON.stringify({ ...settings, gateway: { ...settings.gateway, port: 18888 } })}\n`;
    writeFileSync(path, edited);
    snapshot.persistMigrations();
    expect(readFileSync(path, 'utf8')).toBe(edited);
    expect(writeTextAtomicSync).not.toHaveBeenCalled();
  });

  it('can start with valid settings when disk cleanup is unavailable', () => {
    const path = configFile({ ...settings, workflows: {} });
    const original = readFileSync(path, 'utf8');
    vi.mocked(writeTextAtomicSync).mockImplementationOnce(() => { throw new Error('read-only test file'); });
    expect(loadConfig(path)).not.toHaveProperty('workflows');
    expect(readFileSync(path, 'utf8')).toBe(original);
  });
});

describe('bundled channel activation migration', () => {
  it('preserves channel settings and unrelated extension preferences across repeated loads', () => {
    const channels = {
      telegram: { enabled: true, accounts: { default: { botToken: '123:telegram-fixture' } } },
      feishu: { enabled: true, accounts: { default: { appId: 'cli_fixture', appSecret: 'feishu-fixture' } } },
      weixin: { enabled: true, accounts: { 'weixin-fixture': { enabled: true } } },
    };
    const extensions = {
      enabled: ['feishu-tools', 'other-enabled'],
      disabled: ['telegram', 'feishu-tools', 'weixin', 'other-disabled'],
      config: { 'other-enabled': { example: true } },
    };
    const path = configFile({ ...settings, channels, extensions, workflows: {} });
    const expected = {
      ...settings,
      channels: {
        telegram: { ...channels.telegram, enabled: false },
        feishu: { ...channels.feishu, enabled: false },
        weixin: { ...channels.weixin, enabled: false },
      },
      extensions: { ...extensions, enabled: ['other-enabled'], disabled: ['other-disabled'] },
    };

    expect(loadConfig(path)).toMatchObject(expected);
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(expected);
    expect(loadConfig(path)).toMatchObject(expected);
    expect(writeTextAtomicSync).toHaveBeenCalledTimes(1);
  });

  it('preserves a missing channel as disabled and leaves the global extension switch alone', () => {
    const path = configFile({ ...settings, extensions: { enabled: false, disabled: ['weixin'] } });
    const expected = { channels: { weixin: { enabled: false } }, extensions: { enabled: false } };
    expect(loadConfig(path)).toMatchObject(expected);
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ ...settings, ...expected });
  });

  it('removes obsolete enable overrides without enabling a stopped channel', () => {
    const channels = { telegram: { enabled: false } };
    const path = configFile({ ...settings, channels, extensions: { enabled: ['telegram'] } });
    expect(loadConfig(path)).toMatchObject({ channels, extensions: {} });
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ ...settings, channels, extensions: {} });
  });
});
