import { describe, expect, it } from 'vitest';

import { normalizeDiscussionOrganization } from '../analyzer.js';

function baseOrganization() {
  return {
    title: 'Release planning',
    summary: 'The team discussed the next release.',
    keyPoints: [],
    decisions: [],
    actionItems: [],
    risks: [],
    openQuestions: [],
  };
}

describe('normalizeDiscussionOrganization', () => {
  it('treats null optional model fields as omitted', () => {
    const organization = normalizeDiscussionOrganization({
      ...baseOrganization(),
      projectCandidateId: null,
      projectConfidence: null,
      projectAlternativeConfidence: null,
      actionItems: [{
        id: null,
        title: 'Prepare the release',
        owner: null,
        dueDate: null,
      }],
    });

    expect(organization).not.toHaveProperty('projectCandidateId');
    expect(organization).not.toHaveProperty('projectConfidence');
    expect(organization).not.toHaveProperty('projectAlternativeConfidence');
    expect(organization.actionItems[0]).toMatchObject({ title: 'Prepare the release' });
    expect(organization.actionItems[0]?.id).toMatch(/^[a-f0-9]{16}$/);
    expect(organization.actionItems[0]).not.toHaveProperty('owner');
    expect(organization.actionItems[0]).not.toHaveProperty('dueDate');
  });

  it('keeps required fields strict and reports the failing path', () => {
    expect(() => normalizeDiscussionOrganization({
      ...baseOrganization(),
      title: null,
    })).toThrow('Invalid discussion organization: title: Invalid input: expected string, received null');
  });
});
