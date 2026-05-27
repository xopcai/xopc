import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { ConfigSchema } from '../../../../config/schema.js';
import {
  ensureSetupHandlersLoaded,
  getSetupHandler,
  resetSetupHandlersLoadedForTests,
} from '../index.js';

function makeTempConfig(): string {
  const dir = mkdtempSync(join(tmpdir(), 'xopc-search-setup-'));
  const path = join(dir, 'xopc.json');
  writeFileSync(path, JSON.stringify(ConfigSchema.parse({}), null, 2));
  return path;
}

describe('search setup handlers', () => {
  const cleanup: string[] = [];

  afterEach(() => {
    resetSetupHandlersLoadedForTests();
    for (const p of cleanup) {
      rmSync(p.replace(/\/xopc\.json$/, ''), { recursive: true, force: true });
    }
    cleanup.length = 0;
  });

  it('registers list and configure handlers', async () => {
    await ensureSetupHandlersLoaded();
    expect(getSetupHandler('search', 'list')).toBeDefined();
    expect(getSetupHandler('search', 'configure')).toBeDefined();
  });

  it('configure updates region and maxResults', async () => {
    await ensureSetupHandlersLoaded();
    const configPath = makeTempConfig();
    cleanup.push(configPath);
    const handler = getSetupHandler('search', 'configure');
    const outcome = await handler!.handler({
      configPath,
      fields: { region: 'global', maxResults: 7 },
      options: { dryRun: false, json: true },
    });
    expect(outcome.ok).toBe(true);
    expect(outcome.changedPaths.some((p) => p.includes('tools.web'))).toBe(true);
    const value = outcome.value as { region?: string; maxResults?: number };
    expect(value.region).toBe('global');
    expect(value.maxResults).toBe(7);
  });

  it('list returns providers and tuning summary', async () => {
    await ensureSetupHandlersLoaded();
    const configPath = makeTempConfig();
    cleanup.push(configPath);
    const handler = getSetupHandler('search', 'list');
    const outcome = await handler!.handler({
      configPath,
      fields: {},
      options: { dryRun: false, json: true },
    });
    expect(outcome.ok).toBe(true);
    expect(outcome.action).toBe('noop');
    const value = outcome.value as { providers?: unknown[]; region?: string };
    expect(Array.isArray(value.providers)).toBe(true);
    expect(value.region).toBe('auto');
  });
});
