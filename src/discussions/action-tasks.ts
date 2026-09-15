import { TaskCreateRequestSchema } from '@xopcai/gateway-contract';

import { getSqliteDatabase, runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';
import { TaskApplicationService } from '../tasks/task-application-service.js';
import { TaskRepository } from '../tasks/task-repository.js';

import { DiscussionServiceError } from './errors.js';
import { getDiscussionCapture, getLatestDiscussionOrganization } from './repository.js';
import { readTranscriptRevision } from './revisions.js';

export function meetingActionTasks(id: string) {
  const rows = getSqliteDatabase().prepare('SELECT action_id, task_id FROM discussion_action_tasks WHERE discussion_id=?').all(id) as Array<{ action_id: string; task_id: string }>;
  const tasks = new TaskRepository();
  return rows.map(row => {
    const task = tasks.get(row.task_id);
    return { actionId: row.action_id, taskId: row.task_id, phase: task?.phase, resolution: task?.resolution, deleted: !task };
  });
}

/** Task, contract, source context, outbox and conversion link commit together. */
export function convertMeetingAction(id: string, actionId: string, organizationRevision: number) {
  return runSqliteWriteTransaction(db => {
    const capture = getDiscussionCapture(id);
    if (!capture) throw new DiscussionServiceError('not_found', 'Discussion not found');
    const existing = meetingActionTasks(id).find(row => row.actionId === actionId);
    if (existing) return { ...existing, existing: true };
    const record = getLatestDiscussionOrganization(id);
    if (record?.revision !== organizationRevision) throw new DiscussionServiceError('conflict', 'Meeting summary changed; review the current action');
    const action = record.organization?.actionItems.find(item => item.id === actionId);
    if (!action) throw new DiscussionServiceError('not_found', 'Meeting action not found');
    if ((action.supersededBy || action.disputedBy) && action.reviewedChangeId !== (action.supersededBy ?? action.disputedBy)) throw new DiscussionServiceError('conflict', 'This action has later changes; edit and confirm it before creating a task');
    if (action.ignored) throw new DiscussionServiceError('conflict', 'Restore the ignored action before creating a task');
    const evidenceRevision = action.evidenceRevision ?? record.transcriptRevision;
    const segments = readTranscriptRevision(id, evidenceRevision) ?? [];
    const source = segments.filter(segment => action.evidenceSegmentIds.includes(segment.sequence))
      .map(segment => `[${Math.floor(segment.startedAtMs / 1000)}s] ${segment.displayText ?? segment.rawText ?? ''}`).join('\n');
    const request = TaskCreateRequestSchema.parse({
      idempotencyKey: `meeting:${id}:${actionId}`, title: action.title,
      body: [action.title, action.owner ? `Owner mentioned: ${action.owner}` : '', action.dueDate ? `Date mentioned: ${action.dueDate}` : '', source].filter(Boolean).join('\n\n'),
      projectId: capture.projectId,
      contract: { objective: action.title, expectedOutputs: [], acceptanceCriteria: [], constraints: [], approvalRequired: [], assumptions: [], risks: [], acceptancePolicy: 'manual', outputDestinations: [] },
      context: [{ targetKind: 'document', targetId: capture.noteId, role: 'reference', title: record.organization?.title, pinned: true, retrievalPolicy: {}, metadata: { discussionId: id, transcriptRevision: evidenceRevision, evidenceSegmentIds: action.evidenceSegmentIds } }],
      activation: { mode: 'capture', phase: 'backlog' },
    });
    const result = new TaskApplicationService().create(request);
    if (result.ok === false) throw new DiscussionServiceError('conflict', `Task creation failed: ${result.reason}`);
    const taskId = result.model.task.id;
    db.prepare('INSERT INTO discussion_action_tasks (discussion_id, action_id, task_id, organization_revision, created_at) VALUES (?, ?, ?, ?, ?)').run(id, actionId, taskId, record.revision, Date.now());
    return { actionId, taskId, existing: false, deleted: false };
  });
}
