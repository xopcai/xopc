import { describe, expect, it } from 'vitest';

import { normalizeDiscussionOrganization, partitionDiscussionSegments, validateDiscussionEvidence, summarizeMeetingOverview } from '../analyzer.js';

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


describe('long meeting evidence', () => {
  it('covers the tail of a transcript beyond the former truncation limit', () => {
    const text = 'a'.repeat(125_000) + 'FINAL DECISION';
    const batches = partitionDiscussionSegments([{ sequence: 0, displayText: text, startedAtMs: 0, endedAtMs: 7_200_000 } as never]);
    expect(batches.flat().map(part => part.text).join('')).toBe(text);
    expect(batches.at(-1)!.at(-1)!.text).toContain('FINAL DECISION');
    expect(batches.every(batch => batch.reduce((sum, item) => sum + item.text.length, 0) <= 6_000)).toBe(true);
  });
  it('rejects nonexistent and missing source references instead of publishing them', () => {
    const organization = normalizeDiscussionOrganization({ ...baseOrganization(), decisions: [{ text: 'Ship', evidenceSegmentIds: [99] }] });
    expect(() => validateDiscussionEvidence(organization, new Set([0]))).toThrow('invalid evidence');
    organization.decisions[0]!.evidenceSegmentIds = [];
    expect(() => validateDiscussionEvidence(organization, new Set([0]))).toThrow('invalid evidence');
    organization.decisions[0]!.evidenceSegmentIds = [0];
    expect(() => validateDiscussionEvidence(organization, new Set([0]))).not.toThrow();
  });
});

it('reduces every chapter including the tail without an unbounded merge prompt', async () => {
  const seen: string[] = [];
  const result = await summarizeMeetingOverview(Array.from({ length: 65 }, (_, i) => `chapter-${i}`), async parts => {
    expect(parts.length).toBeLessThanOrEqual(4);
    seen.push(...parts);
    return { title: 'Meeting', summary: parts.join('|') };
  });
  expect(seen).toContain('chapter-64');
  expect(result.summary).toContain('chapter-64');
});
