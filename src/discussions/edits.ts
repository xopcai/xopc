import { z } from 'zod';

import { getSqliteDatabase, runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';

import { DiscussionServiceError } from './errors.js';
import { completeDiscussionOrganization, createDiscussionOrganization, getDiscussionCapture, getLatestDiscussionOrganization } from './repository.js';
import type { DiscussionActionItem, DiscussionFact, DiscussionOrganization } from './types.js';

const kinds = ['summary', 'decisions', 'actionItems', 'risks', 'openQuestions'] as const;
export const MeetingEditSchema = z.object({
  kind: z.enum(kinds), itemId: z.string().max(100), expectedRevision: z.number().int().positive(),
  text: z.string().trim().min(1).max(20_000).optional(),
  owner: z.string().trim().max(200).optional(), dueDate: z.string().trim().max(100).optional(),
  ignored: z.boolean().optional(),
});
type Edit = z.infer<typeof MeetingEditSchema>;
type SavedEdit = { kind: Edit['kind']; item_id: string; value_json: string };

/** Preserve explicit user changes, with the immutable source revision they edited. */
export function applyMeetingEdits(id: string, organization: DiscussionOrganization): DiscussionOrganization {
  const edited = structuredClone(organization);
  const rows = getSqliteDatabase().prepare('SELECT kind, item_id, value_json FROM discussion_edits WHERE discussion_id=?').all(id) as SavedEdit[];
  for (const row of rows) {
    if (row.kind === 'summary') {
      edited.summary = (JSON.parse(row.value_json) as { text: string }).text;
      edited.summaryEditedByUser = true;
      continue;
    }
    const value = JSON.parse(row.value_json) as DiscussionFact | DiscussionActionItem;
    const list: Array<DiscussionFact | DiscussionActionItem> = edited[row.kind];
    const index = list.findIndex(item => item.id === row.item_id);
    if (index < 0) list.push(value);
    else list[index] = { ...value, supersededBy: list[index]!.supersededBy ?? value.supersededBy, disputedBy: list[index]!.disputedBy ?? value.disputedBy };
  }
  return edited;
}

export function editMeeting(id: string, input: Edit) {
  return runSqliteWriteTransaction(db => {
    const capture = getDiscussionCapture(id);
    if (!capture) throw new DiscussionServiceError('not_found', 'Discussion not found');
    if (capture.status !== 'completed' && capture.status !== 'needs_attention') throw new DiscussionServiceError('conflict', 'Wait for meeting processing to finish');
    const previous = getLatestDiscussionOrganization(id);
    if (!previous?.organization || previous.revision !== input.expectedRevision) throw new DiscussionServiceError('conflict', 'Meeting summary changed; reload before editing');
    let value: { text: string } | DiscussionFact | DiscussionActionItem;
    if (input.kind === 'summary') {
      if (!input.text) throw new DiscussionServiceError('invalid_input', 'Summary text is required');
      value = { text: input.text };
    } else {
      const item = previous.organization[input.kind].find(candidate => candidate.id === input.itemId);
      if (!item) throw new DiscussionServiceError('not_found', 'Meeting item not found');
      value = { ...item, evidenceRevision: item.evidenceRevision ?? previous.transcriptRevision, editedByUser: true, reviewedChangeId: item.supersededBy ?? item.disputedBy };
      if (input.text !== undefined) {
        if ('title' in value) value.title = input.text;
        else value.text = input.text;
      }
      if ('title' in value) {
        if (input.owner !== undefined) value.owner = input.owner || undefined;
        if (input.dueDate !== undefined) value.dueDate = input.dueDate || undefined;
      }
      if (input.ignored !== undefined) value.ignored = input.ignored;
    }
    db.prepare('INSERT INTO discussion_edits (discussion_id,kind,item_id,value_json,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(discussion_id,kind,item_id) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at')
      .run(id, input.kind, input.kind === 'summary' ? 'summary' : input.itemId, JSON.stringify(value), Date.now());
    const next = createDiscussionOrganization({ discussionId: id, transcriptRevision: previous.transcriptRevision, inputTranscriptSha256: previous.inputTranscriptSha256, promptVersion: previous.promptVersion, modelRef: previous.modelRef });
    return completeDiscussionOrganization(next.id, applyMeetingEdits(id, previous.organization))!;
  });
}
