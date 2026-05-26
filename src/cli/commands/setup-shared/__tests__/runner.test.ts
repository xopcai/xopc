import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Config } from '../../../../config/schema.js';
import { runSetup, SetupValidationError } from '../runner.js';

function makeTempConfig(initial: object = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'xopc-setup-shared-'));
  const path = join(dir, 'xopc.json');
  writeFileSync(path, JSON.stringify(initial, null, 2));
  return path;
}

describe('runSetup pipeline', () => {
  const cleanup: string[] = [];

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    process.exitCode = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = 0;
    for (const p of cleanup) {
      rmSync(p.replace(/\/xopc\.json$/, ''), { recursive: true, force: true });
    }
    cleanup.length = 0;
  });

  it('writes when changed paths exist and reports them', async () => {
    const configPath = makeTempConfig({});
    cleanup.push(configPath);

    const outcome = await runSetup({
      configPath,
      options: { dryRun: false, json: true },
      mutator: {
        domain: 'providers',
        target: 'openai',
        action: 'add',
        mutate(config: Config) {
          config.providers = config.providers ?? {};
          config.providers.openai = { apiKey: 'sk-test' };
          return config;
        },
        resultValue: (config) => ({
          id: 'openai',
          apiKey: config.providers?.openai?.apiKey ? '***' : null,
        }),
      },
    });

    expect(outcome.ok).toBe(true);
    expect(outcome.action).toBe('add');
    expect(outcome.changedPaths.some((p) => p === 'providers' || p.startsWith('providers.'))).toBe(true);
    expect(outcome.dryRun).toBe(false);
    expect(process.exitCode).toBe(0);

    const saved = JSON.parse(readFileSync(configPath, 'utf8'));
    expect(saved.providers.openai.apiKey).toBe('sk-test');
  });

  it('--dry-run does not modify the file', async () => {
    const configPath = makeTempConfig({});
    cleanup.push(configPath);
    const before = readFileSync(configPath, 'utf8');

    const outcome = await runSetup({
      configPath,
      options: { dryRun: true, json: true },
      mutator: {
        domain: 'providers',
        target: 'openai',
        action: 'add',
        mutate(config: Config) {
          config.providers = config.providers ?? {};
          config.providers.openai = { apiKey: 'sk-dry' };
          return config;
        },
      },
    });

    expect(outcome.ok).toBe(true);
    expect(outcome.dryRun).toBe(true);
    expect(outcome.changedPaths.some((p) => p === 'providers' || p.startsWith('providers.'))).toBe(true);
    expect(readFileSync(configPath, 'utf8')).toBe(before);
  });

  it('reports noop when nothing changes', async () => {
    const configPath = makeTempConfig({
      providers: { openai: { apiKey: 'sk-same' } },
    });
    cleanup.push(configPath);

    const outcome = await runSetup({
      configPath,
      options: { dryRun: false, json: true },
      mutator: {
        domain: 'providers',
        target: 'openai',
        action: 'set',
        mutate(config: Config) {
          config.providers = config.providers ?? {};
          config.providers.openai = { apiKey: 'sk-same' };
          return config;
        },
      },
    });

    expect(outcome.ok).toBe(true);
    expect(outcome.action).toBe('noop');
    expect(outcome.changedPaths).toHaveLength(0);
  });

  it('surfaces SetupValidationError as structured errors', async () => {
    const configPath = makeTempConfig({});
    cleanup.push(configPath);

    const outcome = await runSetup({
      configPath,
      options: { dryRun: false, json: true },
      mutator: {
        domain: 'providers',
        target: 'openai',
        action: 'add',
        mutate() {
          throw new SetupValidationError([
            { path: 'providers.openai', message: 'already exists; use `set` to update' },
          ]);
        },
      },
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.errors?.[0]?.path).toBe('providers.openai');
    expect(process.exitCode).toBe(1);
  });

  it('rejects schema-invalid mutations without writing', async () => {
    const configPath = makeTempConfig({});
    cleanup.push(configPath);
    const before = readFileSync(configPath, 'utf8');

    const outcome = await runSetup({
      configPath,
      options: { dryRun: false, json: true },
      mutator: {
        domain: 'providers',
        target: 'openai',
        action: 'add',
        mutate(config: Config) {
          // `baseUrl` must be a valid URL per ProviderAuthConfigSchema.
          (config as unknown as { providers: Record<string, unknown> }).providers = {
            openai: { baseUrl: 'not-a-url' },
          };
          return config;
        },
      },
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.errors?.length).toBeGreaterThan(0);
    expect(readFileSync(configPath, 'utf8')).toBe(before);
    expect(process.exitCode).toBe(1);
  });
});
