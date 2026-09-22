import type { DiscussionDetail } from './discussion-types';

/** Explicit displayed data only; never includes audio, hidden transcript pages, or ignored items. */
export function discussionPageText(detail: DiscussionDetail, view: 'summary' | 'transcript', options: {
  query: string; page: number; showIgnored: boolean;
}): string {
  if (view === 'summary') {
    const record = detail.organization;
    if (!record) return '';
    const organization = record.organization;
    if (!organization) return '';
    const visible = <T extends { ignored?: boolean }>(items: T[]) => items.filter(item => options.showIgnored || !item.ignored);
    return JSON.stringify({ discussionId: detail.discussion.id, view, revision: record.revision,
      transcriptRevision: record.transcriptRevision, summary: organization.summary,
      decisions: visible(organization.decisions), actionItems: visible(organization.actionItems),
      risks: visible(organization.risks), openQuestions: visible(organization.openQuestions), chapters: organization.chapters,
    }, null, 2);
  }
  const query = options.query.toLocaleLowerCase();
  const segments = detail.transcript.segments.filter(segment => (segment.displayText ?? segment.rawText ?? '').toLocaleLowerCase().includes(query)
    || segment.speakerLabel?.toLocaleLowerCase().includes(query)).slice(0, options.page * 50);
  if (!segments.length) return '';
  return JSON.stringify({ discussionId: detail.discussion.id, view, revision: detail.transcript.revision,
    scope: 'loaded filtered segments only', segments: segments.map(segment => ({ sequence: segment.sequence,
      startedAtMs: segment.startedAtMs, speaker: segment.speakerLabel, text: segment.displayText ?? segment.rawText ?? '' })),
  }, null, 2);
}
