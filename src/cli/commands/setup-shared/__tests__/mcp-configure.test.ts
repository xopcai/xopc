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
  const dir = mkdtempSync(join(tmpdir(), 'xopc-mcp-setup-'));
  const path = join(dir, 'xopc.json');
  writeFileSync(path, JSON.stringify(ConfigSchema.parse({}), null, 2));
  return path;
}

describe('mcp setup handlers', () => {
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
    expect(getSetupHandler('mcp', 'list')).toBeDefined();
    expect(getSetupHandler('mcp', 'configure')).toBeDefined();
  });

  it('configure rejects server without command or url', async () => {
    await ensureSetupHandlersLoaded();
    const handler = getSetupHandler('mcp', 'configure');
    const outcome = await handler!.handler({
      configPath: makeTempConfig(),
      fields: { servers: { bad: { env: {} } } },
      options: { dryRun: true, json: true },
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.errors?.some((e) => e.path?.includes('servers.bad'))).toBe(true);
  });

  it('configure writes stdio server definition', async () => {
    await ensureSetupHandlersLoaded();
    const configPath = makeTempConfig();
    cleanup.push(configPath);
    const handler = getSetupHandler('mcp', 'configure');
    const outcome = await handler!.handler({
      configPath,
      fields: {
        servers: {
          demo: { command: 'node', args: ['server.js'] },
        },
        sessionIdleTtlMinutes: 10,
      },
      options: { dryRun: false, json: true },
    });
    expect(outcome.ok).toBe(true);
    const value = outcome.value as { servers?: Array<{ id: string; transport: string }> };
    expect(value.servers?.some((s) => s.id === 'demo' && s.transport === 'stdio')).toBe(true);
  });
});
