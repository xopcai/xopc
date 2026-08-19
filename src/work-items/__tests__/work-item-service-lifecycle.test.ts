import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ProjectService } from '../../projects/project-service.js';
import {
  closeXopcDatabase,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../../storage/sqlite/index.js';
import { WorkItemTransitionError } from '../lifecycle.js';
import { WorkItemService } from '../work-item-service.js';

describe('WorkItemService lifecycle', () => {
  let stateDir: string;
  let service: WorkItemService;
  let projectId: string;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-work-item-lifecycle-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
    projectId = new ProjectService().create({ name: 'Lifecycle project' }).id;
    service = new WorkItemService();
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('persists command transitions, waits, and lifecycle events atomically', () => {
    const item = service.createProjectWorkItem(projectId, {
      title: 'Ship the lifecycle model',
      initialPhase: 'ready',
    });
    const executing = service.executeCommand(
      item.id,
      { type: 'start', expectedVersion: item.version },
      { actor: { kind: 'agent', id: 'agent-1' }, source: 'agent_tool', requestId: 'request-1' },
    )!;
    const waiting = service.executeCommand(
      item.id,
      {
        type: 'wait',
        expectedVersion: executing.version,
        wait: { kind: 'user_input', reason: 'Choose a release window' },
      },
      { actor: { kind: 'agent', id: 'agent-1' }, source: 'agent_tool', requestId: 'request-2' },
    )!;

    expect(service.getWorkItem(item.id)).toMatchObject({
      phase: 'executing',
      version: 3,
      waits: [{ kind: 'user_input', reason: 'Choose a release window' }],
    });
    expect(service.listEvents(item.id).map((event) => event.type)).toEqual([
      'work_item.wait_created',
      'work_item.started',
      'work_item.created',
    ]);
    expect(() => service.executeCommand(
      item.id,
      { type: 'complete', expectedVersion: waiting.version - 1 },
      { actor: { kind: 'agent', id: 'agent-1' }, source: 'agent_tool', requestId: 'request-3' },
    )).toThrow(WorkItemTransitionError);
    expect(service.getWorkItem(item.id)?.version).toBe(waiting.version);
  });

  it('rejects dependency cycles without writing either item', () => {
    const first = service.createProjectWorkItem(projectId, { title: 'First', initialPhase: 'ready' });
    const second = service.createProjectWorkItem(projectId, { title: 'Second', initialPhase: 'ready' });
    const waitingFirst = service.executeCommand(
      first.id,
      {
        type: 'wait',
        expectedVersion: first.version,
        wait: { kind: 'dependency', reason: 'Second must finish', blockingWorkItemId: second.id },
      },
      { actor: { kind: 'agent', id: 'agent-1' }, source: 'workflow', requestId: 'request-1' },
    )!;

    expect(() => service.executeCommand(
      second.id,
      {
        type: 'wait',
        expectedVersion: second.version,
        wait: { kind: 'dependency', reason: 'First must finish', blockingWorkItemId: first.id },
      },
      { actor: { kind: 'agent', id: 'agent-1' }, source: 'workflow', requestId: 'request-2' },
    )).toThrow('dependency would create a cycle');
    expect(service.getWorkItem(first.id)?.version).toBe(waitingFirst.version);
    expect(service.getWorkItem(second.id)?.version).toBe(second.version);
  });
});
