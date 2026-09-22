import { describe, expect, it } from 'vitest';
import { discussionPageText } from '../discussion-page-context';
import type { DiscussionDetail } from '../discussion-types';

const detail = {
  discussion: { id: 'discussion', audioAttachmentId: 'excluded-audio' },
  transcript: { revision: 7, segments: Array.from({ length: 51 }, (_, sequence) => ({
    sequence, startedAtMs: sequence * 1000, speakerLabel: 'Speaker', rawText: `raw-${sequence}`, displayText: `edited-${sequence}`,
  })) },
  organization: { revision: 3, transcriptRevision: 6, organization: { summary: 'Summary',
    decisions: [{ id: 'kept', text: 'Visible' }, { id: 'ignored', text: 'Hidden', ignored: true }],
    actionItems: [], risks: [], openQuestions: [], chapters: [],
  } },
} as unknown as DiscussionDetail;
const options = { query: '', page: 1, showIgnored: false };

describe('explicit discussion page text', () => {
  it('captures the displayed summary revision and excludes ignored facts by default', () => {
    const text = discussionPageText(detail, 'summary', options);
    expect(JSON.parse(text)).toMatchObject({ revision: 3, transcriptRevision: 6, summary: 'Summary', decisions: [{ id: 'kept' }] });
    expect(text).not.toContain('Hidden');
    expect(text).not.toContain('excluded-audio');
    expect(discussionPageText(detail, 'summary', { ...options, showIgnored: true })).toContain('Hidden');
  });
  it('includes only loaded filtered segments and uses corrected text', () => {
    const text = discussionPageText(detail, 'transcript', options);
    expect(JSON.parse(text).segments).toHaveLength(50);
    expect(text).not.toContain('edited-50');
    expect(text).not.toContain('raw-');
    const filtered = JSON.parse(discussionPageText(detail, 'transcript', { ...options, query: 'edited-50' }));
    expect(filtered.segments).toEqual([{ sequence: 50, startedAtMs: 50000, speaker: 'Speaker', text: 'edited-50' }]);
  });
  it('returns no invented content for missing summaries or empty filters', () => {
    expect(discussionPageText({ ...detail, organization: undefined }, 'summary', options)).toBe('');
    expect(discussionPageText(detail, 'transcript', { ...options, query: 'no match' })).toBe('');
  });
  it('does not silently truncate over-budget text; the UI must reject capture', () => {
    const long = { ...detail, transcript: { ...detail.transcript, segments: [{ ...detail.transcript.segments[0], displayText: 'x'.repeat(16001) }] } };
    expect(discussionPageText(long, 'transcript', options).length).toBeGreaterThan(16000);
  });
});
