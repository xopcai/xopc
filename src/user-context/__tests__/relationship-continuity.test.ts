import { describe, expect, it } from 'vitest';

import type { MemoryRecord } from '../../agent/memory/types.js';
import {
  buildRelationshipContinuityPrompt,
  extractExplicitRelationshipFollowUp,
  RELATIONSHIP_FOLLOW_UP_TAG,
} from '../relationship-continuity.js';

describe('relationship continuity', () => {
  it('only extracts explicit follow-up requests', () => {
    expect(extractExplicitRelationshipFollowUp('我明天要去面试')).toBeNull();
    expect(extractExplicitRelationshipFollowUp('明天问问我面试怎么样', 0)).toEqual({
      subject: '面试怎么样',
      reviewAfter: new Date(24 * 60 * 60 * 1_000).toISOString(),
    });
  });

  it('prompts only when an approved follow-up is due', () => {
    const record = {
      id: 'follow-up',
      kind: 'commitment',
      status: 'active',
      scope: { userId: 'local' },
      provenance: { sourceAgentId: 'main' },
      content: '面试怎么样',
      source: { provider: 'builtin' },
      sensitivity: 'normal',
      explicitness: 'explicit',
      durability: 'recurring',
      importance: 0.8,
      disclosurePolicy: 'referenceable',
      evidence: [],
      reviewAfter: new Date(1_000).toISOString(),
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
      tags: [RELATIONSHIP_FOLLOW_UP_TAG],
    } satisfies MemoryRecord;
    expect(buildRelationshipContinuityPrompt([record], 999)).toBe('');
    expect(buildRelationshipContinuityPrompt([record], 1_000)).toContain('面试怎么样');
  });
});
