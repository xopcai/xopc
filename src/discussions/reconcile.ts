import { z } from 'zod';

import type { DiscussionOrganization } from './types.js';

type Candidate = { id: string; kind: string; text: string; evidenceSegmentIds: number[] };
export const MeetingChangesSchema = z.object({ changes: z.array(z.object({
  fromId: z.string(), toId: z.string(), relation: z.enum(['supersedes', 'contradicts']),
})).max(200) });
export type MeetingChange = z.infer<typeof MeetingChangesSchema>['changes'][number];

function groups(items: Candidate[]): Candidate[][] {
  const result: Candidate[][] = [];
  let current: Candidate[] = [];
  let size = 0;
  for (const item of items) {
    const length = JSON.stringify(item).length;
    if (length > 12_000) throw new Error('Meeting fact exceeds reconciliation input budget');
    if (current.length && size + length > 12_000) { result.push(current); current = []; size = 0; }
    current.push(item); size += length;
  }
  if (current.length) result.push(current);
  return result;
}

/** Relations can only point from an earlier fact to an actual later fact. */
export async function reconcileMeetingChapters(
  chapters: DiscussionOrganization[],
  compare: (earlier: Candidate[], later: Candidate[]) => Promise<MeetingChange[]>,
): Promise<MeetingChange[]> {
  const earlier: Candidate[] = [];
  const changes = new Map<string, MeetingChange>();
  for (const chapter of chapters) {
    const later: Candidate[] = [];
    for (const kind of ['decisions', 'actionItems', 'risks', 'openQuestions'] as const) {
      for (const item of chapter[kind]) later.push({ id: item.id, kind, text: 'title' in item ? item.title : item.text, evidenceSegmentIds: item.evidenceSegmentIds });
    }
    for (const left of groups(earlier)) for (const right of groups(later)) {
      const output = await compare(left, right);
      for (const change of output) {
        if (change.fromId === change.toId || !left.some(item => item.id === change.fromId) || !right.some(item => item.id === change.toId)) throw new Error('Meeting change refers to an invalid or unordered fact');
        changes.set(`${change.fromId}:${change.toId}`, change);
      }
    }
    earlier.push(...later.filter(item => item.kind === 'decisions' || item.kind === 'actionItems'));
  }
  return [...changes.values()];
}
