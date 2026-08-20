import { describe, expect, it } from 'vitest';

import { normalizeEventEnvelope } from '../events/envelope.js';
import { mapProductEventToProactive } from '../events/product-event-bridge.js';

describe('proactive product event bridge', () => {
  it('maps supported internal events without inventing object identity', () => {
    expect(mapProductEventToProactive({
      event: {
        type: 'task.attention_required.v2',
        source: 'tasks',
        occurredAtMs: Date.parse('2026-08-15T01:00:00.000Z'),
        payload: { taskId: 'task-1', reason: 'blocked', agentId: 'main' },
      },
      workspaceId: '/workspace',
      defaultAgentId: 'fallback',
    })).toMatchObject({
      type: 'task.attention_required.v2',
      subject: { kind: 'task', id: 'task-1' },
      scope: { workspaceId: '/workspace', agentId: 'main' },
      dedupeKey: 'product-event:task.attention_required.v2:task-1:1786755600000',
      sensitivity: 'personal',
    });
  });

  it('ignores unsupported or malformed events', () => {
    expect(mapProductEventToProactive({
      event: { type: 'unknown', payload: {} },
      workspaceId: '/workspace',
      defaultAgentId: 'main',
    })).toBeNull();
    expect(mapProductEventToProactive({
      event: { type: 'note.updated', payload: {} },
      workspaceId: '/workspace',
      defaultAgentId: 'main',
    })).toBeNull();
  });

  it('maps a completed discussion into project-scoped proactive context', () => {
    expect(mapProductEventToProactive({
      event: {
        type: 'discussion.completed',
        source: 'discussions',
        occurredAtMs: Date.parse('2026-08-15T02:00:00.000Z'),
        payload: { discussionId: 'discussion-1', noteId: 'note-1', projectId: 'project-1' },
      },
      workspaceId: '/workspace',
      defaultAgentId: 'main',
    })).toMatchObject({
      type: 'discussion.completed.v1',
      subject: { kind: 'discussion', id: 'discussion-1' },
      scope: { projectId: 'project-1' },
      sensitivity: 'personal',
    });
  });

  it.each([
    ['note.created', { noteId: 'note-1' }, 'note.created.v1'],
    ['note.updated', { noteId: 'note-1' }, 'note.updated.v1'],
    ['workflow.run.completed', { runId: 'run-1' }, 'workflow.run.completed.v1'],
    ['session.transcript.updated', { sessionKey: 'session-1' }, 'session.transcript.updated.v1'],
    ['discussion.completed', { discussionId: 'discussion-1' }, 'discussion.completed.v1'],
  ])('versions the %s product event for the proactive event envelope', (type, payload, expectedType) => {
    const mapped = mapProductEventToProactive({
      event: { type, payload, occurredAtMs: Date.parse('2026-08-15T03:00:00.000Z') },
      workspaceId: '/workspace',
      defaultAgentId: 'main',
    });

    expect(mapped).toMatchObject({ type: expectedType, schemaVersion: 1 });
    expect(() => normalizeEventEnvelope(mapped!)).not.toThrow();
  });
});
