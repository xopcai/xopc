import { describe, expect, it } from 'vitest';

import type { UserFocus, UserUnderstanding } from '../user-context-api';
import { buildSharedUnderstandingModel, rankUnderstandingRelations } from '../shared-understanding-model';

function focus(patch: Partial<UserFocus> = {}): UserFocus {
  return {
    id: 'focus-1', versionId: 'focus-version-1', principalId: 'local-owner', title: '改善共同理解体验', summary: '重构 You 页面关系图', horizon: 'current',
    status: 'active', confidence: 0.9, scope: { type: 'global' }, explicitness: 'inferred',
    sensitivity: 'normal', disclosurePolicy: 'referenceable', evidenceRefs: [], createdAt: 10, updatedAt: 20, ...patch,
  };
}

function understanding(patch: Partial<UserUnderstanding> = {}): UserUnderstanding {
  return {
    id: 'understanding-1', kind: 'preference', status: 'active', scope: { type: 'global' },
    explicitness: 'explicit', durability: 'durable', sensitivity: 'normal', disclosurePolicy: 'referenceable',
    confidence: 1, statement: '共同理解页面应该先显示重点', versionId: 'version-1', createdAt: 10, updatedAt: 10,
    ...patch,
  };
}

describe('shared understanding model', () => {
  it('separates current, review, and historical items without duplicate surfaces', () => {
    const model = buildSharedUnderstandingModel([
      focus(),
      focus({ id: 'focus-review', status: 'candidate', updatedAt: 30 }),
      focus({ id: 'focus-history', status: 'completed', updatedAt: 5 }),
    ], [
      understanding(),
      understanding({ id: 'understanding-review', status: 'needs_review', updatedAt: 40 }),
      understanding({ id: 'understanding-history', status: 'rejected', updatedAt: 4 }),
      understanding({ id: 'rejected-inferred-candidate', status: 'rejected', explicitness: 'inferred', updatedAt: 3 }),
    ]);

    expect(model.currentFocuses.map((item) => item.id)).toEqual(['focus-1']);
    expect(model.activeUnderstandings.map((item) => item.id)).toEqual(['understanding-1']);
    expect(model.reviewQueue.map((item) => item.id)).toEqual(['understanding-review', 'focus-review']);
    expect(model.history.map((item) => item.id)).toEqual(['focus-history', 'understanding-history', 'rejected-inferred-candidate']);
    expect(model.timeline.map((item) => item.id)).toEqual([
      'focus-1', 'understanding-1', 'focus-history', 'understanding-history',
    ]);
  });

  it('ranks explainable project, topic, and global-context relations', () => {
    const relations = rankUnderstandingRelations(focus({ scope: { type: 'project', id: 'project-1' } }), [
      understanding({ id: 'global' }),
      understanding({
        id: 'project', kind: 'project_context', scope: { type: 'project', id: 'project-1' },
        statement: '移动端发布背景', updatedAt: 11,
      }),
      understanding({
        id: 'topic', kind: 'derived_insight', scope: { type: 'global' },
        statement: 'You 页面共同理解关系图需要减少操作', updatedAt: 12,
      }),
      understanding({
        id: 'unrelated', kind: 'task_lesson', scope: { type: 'session', id: 'session-1' },
        statement: '数据库迁移必须使用事务', updatedAt: 13,
      }),
    ]);

    expect(relations.map((relation) => relation.understanding.id)).toEqual(['project', 'global', 'topic']);
    expect(relations[0]?.reasons).toContain('project_scope');
    expect(relations.find((relation) => relation.understanding.id === 'topic')?.reasons).toContain('topic_overlap');
    expect(relations.find((relation) => relation.understanding.id === 'global')?.reasons).toContain('global_context');
  });
});
