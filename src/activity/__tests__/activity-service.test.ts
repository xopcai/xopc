import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  closeXopcDatabase,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../../storage/sqlite/index.js';
import { runWithLogContext } from '../../utils/logger/context.js';
import { runWithActivityContext } from '../context.js';
import { emitActivity, systemActivityActor, systemActivitySource } from '../emitter.js';
import { ActivityService, ObjectLinkService } from '../service.js';

describe('ActivityService', () => {
  let stateDir: string;
  let activity: ActivityService;
  let links: ObjectLinkService;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-activity-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
    activity = new ActivityService();
    links = new ObjectLinkService();
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('records activity with stable project and session scopes', () => {
    const event = activity.record({
      type: 'task.created',
      primaryObject: { kind: 'task', id: 'task-1', title: 'Validate feasibility' },
      actor: { kind: 'agent', agentId: 'main', sessionKey: 'session-1' },
      initiator: { kind: 'user', id: 'user-1' },
      source: { kind: 'xopc_use', toolCallId: 'tool-1' },
      payload: { title: 'Validate feasibility', status: 'todo' },
      scopes: [
        { scopeKind: 'project', scopeId: 'project-1', reason: 'object_owner' },
        { scopeKind: 'session', scopeId: 'session-1', reason: 'runtime_context' },
      ],
      nowMs: 100,
    });

    expect(event.id).toBeTruthy();
    expect(event.scopes.map((scope) => `${scope.scopeKind}:${scope.scopeId}:${scope.reason}`)).toEqual([
      'project:project-1:object_owner',
      'session:session-1:runtime_context',
    ]);

    const projectPage = activity.listForProject({ projectId: 'project-1' });
    expect(projectPage.items.map((item) => item.id)).toEqual([event.id]);
    expect(projectPage.items[0]?.payload).toEqual({ title: 'Validate feasibility', status: 'todo' });

    const objectPage = activity.listForObject({ object: { kind: 'task', id: 'task-1' } });
    expect(objectPage.items.map((item) => item.type)).toEqual(['task.created']);
  });

  it('keeps related project activity separate from stable project activity', () => {
    const event = activity.record({
      type: 'note.created',
      primaryObject: { kind: 'note', id: 'note-1', title: 'Loose note' },
      actor: { kind: 'user', id: 'user-1' },
      source: { kind: 'gateway_api', requestId: 'req-1' },
      payload: { contentPreview: 'Research note', contentLength: 13 },
      relatedProjects: [
        { projectId: 'project-1', reason: 'object_link', confidence: 0.8, computedAt: 120 },
      ],
      nowMs: 110,
    });

    expect(activity.listForProject({ projectId: 'project-1' }).items).toHaveLength(0);

    const withRelated = activity.listForProject({ projectId: 'project-1', includeRelated: true });
    expect(withRelated.items.map((item) => item.id)).toEqual([event.id]);
    expect(withRelated.items[0]?.relatedProjects[0]).toMatchObject({
      projectId: 'project-1',
      reason: 'object_link',
      confidence: 0.8,
    });
  });

  it('stores object links independently of activity events', () => {
    const link = links.create({
      from: { kind: 'note', id: 'note-1', title: 'Research note' },
      to: { kind: 'project', id: 'project-1', title: 'Research Project' },
      relation: 'belongs_to',
      source: 'agent',
      nowMs: 200,
    });

    expect(link.relation).toBe('belongs_to');

    const noteLinks = links.listForObject({ kind: 'note', id: 'note-1' });
    expect(noteLinks).toHaveLength(1);
    expect(noteLinks[0]?.to.id).toBe('project-1');

    const projectLinks = links.listForObject({ kind: 'project', id: 'project-1' });
    expect(projectLinks).toHaveLength(1);
    expect(projectLinks[0]?.from.id).toBe('note-1');
  });

  it('paginates global activity by created time', () => {
    for (let i = 0; i < 3; i += 1) {
      activity.record({
        type: 'project.updated',
        primaryObject: { kind: 'project', id: `project-${i}` },
        actor: { kind: 'system' },
        source: { kind: 'system' },
        payload: { index: i },
        visibility: i === 0 ? 'audit' : 'timeline',
        nowMs: 100 + i,
      });
    }

    const page = activity.list({ visibility: 'timeline', limit: 1 });
    expect(page.total).toBe(2);
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.primaryObject.id).toBe('project-2');
    expect(page.hasMore).toBe(true);
  });

  it('applies async activity context when emitting activity', () => {
    runWithActivityContext(
      {
        actor: { kind: 'agent', agentId: 'main', sessionKey: 'session-1' },
        initiator: { kind: 'user', sessionKey: 'session-1' },
        source: { kind: 'xopc_use', toolCallId: 'tool-1' },
      },
      () => {
        emitActivity({
          type: 'project.updated',
          primaryObject: { kind: 'project', id: 'project-1', title: 'Context Project' },
          actor: systemActivityActor(),
          source: systemActivitySource(),
          payload: { changes: ['brief'] },
          nowMs: 300,
        });
      },
    );

    const page = activity.list();
    expect(page.items[0]).toMatchObject({
      actor: { kind: 'agent', agentId: 'main', sessionKey: 'session-1' },
      initiator: { kind: 'user', sessionKey: 'session-1' },
      source: { kind: 'xopc_use', toolCallId: 'tool-1' },
    });
  });

  it('copies request correlation into emitted activity source', () => {
    runWithLogContext({ requestId: 'req-1' }, () => {
      runWithActivityContext({ source: { kind: 'gateway_api' } }, () => {
        emitActivity({
          type: 'project.updated',
          primaryObject: { kind: 'project', id: 'project-1', title: 'Gateway Project' },
          actor: systemActivityActor(),
          source: systemActivitySource(),
          payload: { changes: ['name'] },
          nowMs: 400,
        });
      });
    });

    expect(activity.list().items[0]).toMatchObject({
      source: { kind: 'gateway_api', requestId: 'req-1' },
    });
  });
});
