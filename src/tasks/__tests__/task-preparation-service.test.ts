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
import { buildTaskExecutionDirective } from '../task-context-assembler.js';
import { TaskExecutionService } from '../task-execution-service.js';
import { TaskPreparationService } from '../task-preparation-service.js';
import { TaskRepository } from '../task-repository.js';

describe('TaskPreparationService', () => {
  const sessionKey = 'agent:main:webchat:default:direct:task-plan';
  let stateDir: string;
  let projects: ProjectService;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-task-preparation-'));
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
    const created = new TaskExecutionService().create({
      objective: 'Launch the product',
      projectId: project.id,
      sessionKey,
      contextText: 'The launch must preserve the existing billing flow.',
      contextAttachments: [{
        id: 'launch-brief',
        bucket: 'inbound',
        type: 'document',
        mimeType: 'text/plain',
        name: 'launch-brief.txt',
        size: 12,
        uri: 'media://inbound/launch-brief.txt',
        path: join(stateDir, 'launch-brief.txt'),
      }],
    });
    patchSessionMetadata(sessionKey, { customData: { taskId: created.taskId } });
    const plan = vi.fn(async () => ({
      objective: 'Launch the product',
      taskContext: 'The launch must preserve the existing billing flow.',
      expectedOutputs: ['Published launch package'],
      acceptanceCriteria: ['Launch package is published and accessible'],
      constraints: ['Use the approved brand'],
      approvalRequired: ['Publish externally'],
      assumptions: ['Brand assets are current'],
      risks: ['Publication may be delayed'],
    }));
    const service = new TaskPreparationService({
      getConfig: () => ConfigSchema.parse({}),
      projects,
      planner: { plan },
    });

    await service.prepare(created.taskId);
    await service.prepare(created.taskId);

    expect(plan).toHaveBeenCalledOnce();
    expect(plan).toHaveBeenCalledWith(expect.objectContaining({
      objective: 'Launch the product',
      taskContext: expect.stringMatching(/launch must preserve[\s\S]*already attached[\s\S]*launch-brief\.txt/i),
      projectContext: expect.stringContaining('Ship in September'),
      userContext: expect.stringContaining('supportMode'),
    }));
    expect(new TaskRepository().get(created.taskId)).toMatchObject({
      status: 'planning',
      latestContractVersion: 2,
      contract: { acceptanceCriteria: ['Launch package is published and accessible'] },
    });
    expect(new TaskRepository().get(created.taskId)?.execution.nextAction).toBeUndefined();
    const directive = buildTaskExecutionDirective(sessionKey);
    expect(directive).toContain('durable user task');
    expect(directive).toContain('Launch package is published and accessible');
    expect(directive).toContain('Publish externally');
    expect(directive).toContain('Do not claim completion without inspectable evidence');
  });

  it('keeps the initial contract when planning fails', async () => {
    const created = new TaskExecutionService().create({ objective: 'Recover safely', sessionKey });
    const service = new TaskPreparationService({
      getConfig: () => ConfigSchema.parse({}),
      projects,
      planner: { plan: vi.fn(async () => { throw new Error('planner unavailable'); }) },
    });

    await expect(service.prepare(created.taskId)).resolves.toBeUndefined();
    expect(new TaskRepository().get(created.taskId)).toMatchObject({
      status: 'planning',
      latestContractVersion: 1,
    });
  });
});
