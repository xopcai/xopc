import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createBrowserActionRegistry } from '../../actions/registry.js';
import {
  closeXopcDatabase,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../../../storage/sqlite/index.js';
import { BrowserRecipeService } from '../service.js';

const RECIPE = `apiVersion: xopc.ai/browser-recipe/v1
id: collect-title
name: Collect title
risk: read_only
domains:
  - example.com
args:
  query:
    type: string
    required: true
pipeline:
  - navigate:
      url: https://example.com
`;

async function waitForRun(service: BrowserRecipeService, runId: string) {
  const deadline = Date.now() + 2_000;
  let run = service.getRun(runId);
  while (run && (run.status === 'queued' || run.status === 'running') && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    run = service.getRun(runId);
  }
  return run;
}

describe('BrowserRecipeService', () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-browser-recipe-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('saves only strict v1 recipes and increments revisions', () => {
    const service = new BrowserRecipeService(createBrowserActionRegistry(), vi.fn());
    const first = service.save({ yaml: RECIPE });
    const second = service.save({ yaml: RECIPE.replace('Collect title', 'Collect page title'), expectedId: first.id });

    expect(first).toMatchObject({ id: 'collect-title', revision: 1, status: 'published' });
    expect(second).toMatchObject({ revision: 2, name: 'Collect page title', status: 'published' });
    expect(() => service.save({ yaml: 'name: legacy\npipeline: []' })).toThrow(/apiVersion/);
  });

  it('keeps a paused workflow paused when its steps are updated', () => {
    const service = new BrowserRecipeService(createBrowserActionRegistry(), vi.fn());
    service.save({ yaml: RECIPE, status: 'disabled' });

    const updated = service.save({
      yaml: RECIPE.replace('Collect title', 'Collect page title'),
      expectedId: 'collect-title',
    });

    expect(updated.status).toBe('disabled');
  });

  it('records the immutable recipe snapshot, result, and step events', async () => {
    const execute = vi.fn(async ({ onStep }: Parameters<ConstructorParameters<typeof BrowserRecipeService>[1]>[0]) => {
      onStep({ index: 0, scope: 'pipeline', action: 'navigate', status: 'started' });
      onStep({ index: 0, scope: 'pipeline', action: 'navigate', status: 'completed', elapsedMs: 3 });
      return { ok: true, action: 'pipeline', data: { title: 'Example' } };
    });
    const service = new BrowserRecipeService(createBrowserActionRegistry(), execute);
    service.save({ yaml: RECIPE, status: 'published' });

    const queued = service.startRun('collect-title', { query: 'xopc' });
    const run = await waitForRun(service, queued.id);

    expect(run).toMatchObject({ status: 'succeeded', recipeRevision: 1, recipeYaml: RECIPE, result: { title: 'Example' } });
    expect(service.listRunEvents(queued.id).map((event) => event.type)).toEqual([
      'run.queued',
      'run.started',
      'step.started',
      'step.completed',
      'run.completed',
    ]);
  });

  it('marks an aborted executor result as cancelled', async () => {
    const service = new BrowserRecipeService(createBrowserActionRegistry(), async ({ signal }) => {
      await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
      return { ok: false, action: 'pipeline', error: { code: 'ABORTED', message: 'Pipeline aborted' } };
    });
    service.save({ yaml: RECIPE, status: 'published' });

    const queued = service.startRun('collect-title', { query: 'xopc' });
    expect(service.cancel(queued.id)).toBe(true);

    expect(await waitForRun(service, queued.id)).toMatchObject({ status: 'cancelled' });
  });
});
