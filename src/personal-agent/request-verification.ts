import { createHash } from 'node:crypto';

import { getSqliteDatabase } from '../storage/sqlite/transaction.js';
import { personalRequestForTask } from './request-repository.js';
import { PersonalRequestResultSchema } from './request-result.js';

/** Bind acceptance to the exact structured result that will be delivered. */
export function personalRequestReviewSnapshot(taskId: string, runId: string) {
  const request = personalRequestForTask(taskId);
  if (!request) return undefined;
  const stored = getSqliteDatabase().prepare('SELECT result_json, result_run_id FROM personal_requests WHERE request_id = ?')
    .get(request.requestId) as { result_json: string | null; result_run_id: string | null };
  const result = stored.result_json && stored.result_run_id === runId
    ? PersonalRequestResultSchema.safeParse(JSON.parse(stored.result_json)) : undefined;
  const content = result?.success ? JSON.stringify(result.data) : undefined;
  return { content, hash: content ? createHash('sha256').update(content).digest('hex') : undefined,
    complete: Boolean(result?.success && !result.data.coverage?.partial
      && (!['composio-gmail', 'composio-outlook'].includes(request.connectorId) || result.data.coverage)) };
}
