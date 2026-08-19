import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  closeXopcDatabase,
  ensureSessionRecord,
  openXopcDatabase,
  patchSessionMetadata,
  resetXopcDatabaseSingletonForTest,
} from '../../storage/sqlite/index.js';
import { assembleTaskContext } from '../task-context-assembler.js';
import { TaskRepository } from '../task-repository.js';

describe('assembleTaskContext', () => {
  let stateDir: string;
  const sessionKey = 'agent:main:webchat:default:direct:context-allocation';

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-task-context-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
    ensureSessionRecord(sessionKey, stateDir);
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('retrieves memory against the full high-risk task rather than only the latest message', () => {
    const task = new TaskRepository().create({
      objective: 'Publish the release',
      expectedOutputs: ['Production release'],
      acceptanceCriteria: ['Production reports version 2.0.0'],
      constraints: ['Do not expose credentials'],
      approvalRequired: ['Production publish'],
      assumptions: ['Release branch is current'],
      risks: ['Production outage'],
      priority: 'critical',
      contextText: 'The customer launch date cannot move.',
    });
    patchSessionMetadata(sessionKey, { customData: { taskId: task.id } });

    const assembled = assembleTaskContext(sessionKey, '继续');

    expect(assembled.allocation).toMatchObject({ profile: 'critical', maxResults: 32, maxChars: 64_000 });
    expect(assembled.retrievalQuery).toContain('Publish the release');
    expect(assembled.retrievalQuery).toContain('Production reports version 2.0.0');
    expect(assembled.retrievalQuery).toContain('Do not expose credentials');
    expect(assembled.retrievalQuery).toContain('Production outage');
    expect(assembled.retrievalQuery).toContain('The customer launch date cannot move.');
    expect(assembled.manifest).toMatchObject({
      taskId: task.id,
      allocation: 'critical',
      assumptions: ['Release branch is current'],
      unresolvedCriteria: ['Production reports version 2.0.0'],
      sources: [{ kind: 'task_contract' }],
    });
  });
});
