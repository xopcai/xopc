import { describe, expect, it } from 'vitest';

import { mapProductEventToProactive } from '../events/product-event-bridge.js';

describe('proactive product event bridge', () => {
  it('maps supported internal events without inventing object identity', () => {
    expect(mapProductEventToProactive({
      event: {
        type: 'goal.status_changed',
        source: 'goals',
        occurredAtMs: Date.parse('2026-08-15T01:00:00.000Z'),
        payload: { goalId: 'goal-1', status: 'blocked', agentId: 'main' },
      },
      workspaceId: '/workspace',
      defaultAgentId: 'fallback',
    })).toMatchObject({
      type: 'goal.status_changed.v1',
      subject: { kind: 'goal', id: 'goal-1' },
      scope: { workspaceId: '/workspace', agentId: 'main' },
      dedupeKey: 'product-event:goal.status_changed:goal-1:1786755600000',
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
});
