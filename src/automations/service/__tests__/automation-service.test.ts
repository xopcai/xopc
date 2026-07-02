import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  closeXopcDatabase,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../../../storage/sqlite/index.js';
import { AutomationService } from '../automation-service.js';

async function waitFor<T>(read: () => Promise<T> | T, predicate: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 2_000;
  let last = await read();
  while (!predicate(last) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    last = await read();
  }
  return last;
}

describe('AutomationService', () => {
  let stateDir: string;
  let service: AutomationService;

  beforeEach(async () => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-automation-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
    service = new AutomationService();
    service.setDeps({
      getDefaultAgentId: () => 'main',
      agentService: {
        turnDispatcher: {
          processDirect: async (message) => `done: ${message}`,
        },
        getModelForSession: () => 'openai/gpt-4o-mini',
      },
    });
    await service.initialize();
  });

  afterEach(async () => {
    await service.stop();
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('creates and runs an agent automation', async () => {
    const automation = await service.create({
      name: 'Daily brief',
      trigger: { kind: 'manual' },
      action: { kind: 'agent', instruction: 'summarize today' },
    });

    const queued = await service.runNow(automation.id);
    expect(queued.status).toBe('queued');

    const runs = await waitFor(
      () => service.listRuns({ automationId: automation.id, limit: 5 }),
      (items) => items.some((item) => item.id === queued.id && item.status === 'succeeded'),
    );
    const completed = runs.find((item) => item.id === queued.id);
    expect(completed).toMatchObject({
      status: 'succeeded',
      summary: 'done: summarize today',
      model: 'openai/gpt-4o-mini',
    });
    expect(completed?.sessionKey).toContain('automation');

    const updated = await service.get(automation.id);
    expect(updated?.state.lastRunStatus).toBe('succeeded');
    expect(updated?.state.runningRunId).toBeUndefined();
  });
});
