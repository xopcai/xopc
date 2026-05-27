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
  const dir = mkdtempSync(join(tmpdir(), 'xopc-agents-setup-'));
  const path = join(dir, 'xopc.json');
  writeFileSync(path, JSON.stringify(ConfigSchema.parse({}), null, 2));
  return path;
}

describe('agents set-model setup handler', () => {
  const cleanup: string[] = [];

  afterEach(() => {
    resetSetupHandlersLoadedForTests();
    for (const p of cleanup) {
      rmSync(p.replace(/\/xopc\.json$/, ''), { recursive: true, force: true });
    }
    cleanup.length = 0;
  });

  it('registers set-model handler via models module load', async () => {
    await ensureSetupHandlersLoaded();
    expect(getSetupHandler('agents', 'set-model')).toBeDefined();
  });

  it('rejects unknown model ref', async () => {
    await ensureSetupHandlersLoaded();
    const handler = getSetupHandler('agents', 'set-model');
    const outcome = await handler!.handler({
      configPath: makeTempConfig(),
      fields: { model: 'not-a-real-provider/not-a-model' },
      options: { dryRun: true, json: true },
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.errors?.[0]?.path).toBe('model');
  });

  it('requires model field', async () => {
    await ensureSetupHandlersLoaded();
    const handler = getSetupHandler('agents', 'set-model');
    const outcome = await handler!.handler({
      configPath: makeTempConfig(),
      fields: {},
      options: { dryRun: true, json: true },
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.errors?.[0]?.path).toBe('model');
  });

  it('dry-run accepts a known built-in model ref', async () => {
    await ensureSetupHandlersLoaded();
    const configPath = makeTempConfig();
    cleanup.push(configPath);
    const handler = getSetupHandler('agents', 'set-model');
    const outcome = await handler!.handler({
      configPath,
      fields: { model: 'openai/gpt-4o' },
      options: { dryRun: true, json: true },
    });
    expect(outcome.ok).toBe(true);
    expect(outcome.notes?.some((n) => /agents\.defaults\.model/i.test(n))).toBe(true);
  });
});
