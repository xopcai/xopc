import { DiscussionServiceError } from './errors.js';
import type { DiscussionDetail } from './types.js';

const time = (ms: number) => `${String(Math.floor(ms / 3_600_000)).padStart(2, '0')}:${String(Math.floor(ms / 60_000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')},${String(Math.round(ms) % 1000).padStart(3, '0')}`;
export function exportDiscussion(detail: DiscussionDetail, format: string): string {
  const segments = detail.transcript.segments.filter(segment => segment.status === 'confirmed');
  if (format === 'txt') return segments.map(segment => `${time(segment.startedAtMs)} ${segment.speakerLabel ?? ''}\n${segment.displayText ?? segment.rawText ?? ''}`).join('\n\n');
  if (format === 'srt') return segments.map((segment, index) => `${index + 1}\n${time(segment.startedAtMs)} --> ${time(segment.endedAtMs)}\n${segment.speakerLabel ? `${segment.speakerLabel}: ` : ''}${segment.displayText ?? segment.rawText ?? ''}`).join('\n\n');
  if (format !== 'md') throw new DiscussionServiceError('invalid_input', 'Unsupported export format');
  const organization = detail.organization?.organization;
  if (!organization) throw new DiscussionServiceError('conflict', 'Meeting summary is not ready');
  return [`# ${organization.title}`, organization.summary,
    ...[['Decisions', organization.decisions.filter(item => !item.ignored && !item.supersededBy).map(item => item.text)], ['Actions', organization.actionItems.filter(item => !item.ignored && !item.supersededBy).map(item => `${item.title}${item.owner ? ` · ${item.owner}` : ''}${item.dueDate ? ` · ${item.dueDate}` : ''}`)], ['Risks', organization.risks.filter(item => !item.ignored && !item.supersededBy).map(item => item.text)], ['Open questions', organization.openQuestions.filter(item => !item.ignored && !item.supersededBy).map(item => item.text)]].map(([title, items]) => `## ${title}\n\n${(items as string[]).map(text => `- ${text}`).join('\n')}`),
  ].join('\n\n');
}
