import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConfigSchema } from '../../config/schema.js';
import { ProjectService } from '../../projects/project-service.js';
import {
  closeXopcDatabase,
  ensureSessionRecord,
  openXopcDatabase,
  patchSessionMetadata,
  resetXopcDatabaseSingletonForTest,
} from '../../storage/sqlite/index.js';
import { buildOutcomeExecutionDirective } from '../outcome-context-assembler.js';
import { OutcomeExecutionService } from '../outcome-execution-service.js';
import { OutcomeExecutionStateRepository } from '../outcome-execution-state.js';
import { OutcomePreparationService } from '../outcome-preparation-service.js';
import { OutcomeRepository } from '../outcome-repository.js';

describe('OutcomePreparationService', () => {
  const sessionKey = 'agent:main:webchat:default:direct:outcome-plan';
  let stateDir: string;
  let projects: ProjectService;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-outcome-preparation-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
    projects = new ProjectService();
    ensureSessionRecord(sessionKey, stateDir);
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('plans the first run once with project and user context', async () => {
    const project = projects.create({ name: 'Launch', brief: 'Ship in September' });
    const created = new OutcomeExecutionService().create({
      objective: 'Launch the product',
      projectId: project.id,
      sessionKey,
    });
    patchSessionMetadata(sessionKey, { customData: { outcomeId: created.outcomeId } });
    const plan = vi.fn(async () => ({
      objective: 'Launch the product',
      deliverables: ['Published launch package'],
      acceptanceCriteria: ['Launch package is published and accessible'],
      constraints: ['Use the approved brand'],
      approvalRequired: ['Publish externally'],
      assumptions: ['Brand assets are current'],
      risks: ['Publication may be delayed'],
    }));
    const service = new OutcomePreparationService({
      getConfig: () => ConfigSchema.parse({}),
      projects,
      planner: { plan },
    });

    await service.prepare(sessionKey);
    await service.prepare(sessionKey);

    expect(plan).toHaveBeenCalledOnce();
    expect(plan).toHaveBeenCalledWith(expect.objectContaining({
      objective: 'Launch the product',
      projectContext: expect.stringContaining('Ship in September'),
      userContext: expect.stringContaining('supportMode'),
    }));
    expect(new OutcomeRepository().get(created.outcomeId)).toMatchObject({
      internalStatus: 'planning',
      latestContractVersion: 2,
      contract: { acceptanceCriteria: ['Launch package is published and accessible'] },
    });
    expect(new OutcomeExecutionStateRepository().get(created.outcomeId)?.nextAction)
      .toBe('Launch package is published and accessible');
    const directive = buildOutcomeExecutionDirective(sessionKey);
    expect(directive).toContain('durable user outcome');
    expect(directive).toContain('Launch package is published and accessible');
    expect(directive).toContain('Publish externally');
    expect(directive).toContain('Do not claim completion without inspectable evidence');
  });

  it('keeps the initial contract when planning fails', async () => {
    const created = new OutcomeExecutionService().create({ objective: 'Recover safely', sessionKey });
    const service = new OutcomePreparationService({
      getConfig: () => ConfigSchema.parse({}),
      projects,
      planner: { plan: vi.fn(async () => { throw new Error('planner unavailable'); }) },
    });

    await expect(service.prepare(sessionKey)).resolves.toBeUndefined();
    expect(new OutcomeRepository().get(created.outcomeId)).toMatchObject({
      internalStatus: 'captured',
      latestContractVersion: 1,
    });
  });
});
