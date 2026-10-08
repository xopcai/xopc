import type { AgentTool } from '@earendil-works/pi-agent-core';
import { Type } from '@sinclair/typebox';

import { getSqliteDatabase } from '../../storage/sqlite/transaction.js';
import { personalRequestForExecution } from '../../personal-agent/request-repository.js';
import { PersonalRequestResultSchema } from '../../personal-agent/request-result.js';
import { TaskRunRepository } from '../../tasks/task-run-repository.js';

const Schema = Type.Object({
  summary: Type.String({ minLength: 1, maxLength: 8000 }),
  coverage: Type.Optional(Type.Object({ from: Type.String(), to: Type.String(), scannedCount: Type.Integer({ minimum: 0 }), partial: Type.Boolean() })),
  items: Type.Array(Type.Object({ messageId: Type.String(), subject: Type.String(), sender: Type.String(),
    receivedAt: Type.String(), importanceReason: Type.String(), suggestedAction: Type.Optional(Type.String()),
    openUrl: Type.Optional(Type.String()) }), { maxItems: 50 }),
});
export function createPersonalRequestResultTool(conversationId: () => string | undefined): AgentTool<typeof Schema> {
  return { name: 'personal_request_result', label: 'Publish connected-app result', parameters: Schema,
    description: 'Publish the read-only Personal request result to its originating main chat. For mail, include actual message IDs, senders, dates, importance reasons, Gmail or Outlook links, and query coverage. partial must be true when the requested range was not fully searched. Do not invent messages or claim an empty inbox after an incomplete search.',
    async execute(_id, params) {
      const id = conversationId();
      const request = id ? personalRequestForExecution(id) : undefined;
      if (!request || ['cancelled', 'completed', 'failed'].includes(request.state)) throw new Error('No active Personal request');
      const result = PersonalRequestResultSchema.parse(params);
      if (['composio-gmail', 'composio-outlook'].includes(request.connectorId) && !result.coverage) throw new Error('Mail results require query coverage, including partial failures');
      if (result.coverage && Date.parse(result.coverage.from) >= Date.parse(result.coverage.to)) throw new Error('Invalid coverage range');
      if (result.coverage && request.parameters.timeRange
        && (Date.parse(result.coverage.from) > Date.parse(request.parameters.timeRange.from)
          || Date.parse(result.coverage.to) < Date.parse(request.parameters.timeRange.to))) result.coverage.partial = true;
      const run = request.taskId ? new TaskRunRepository().getActiveRoot(request.taskId) : undefined;
      if (!run || run.conversationId !== id) throw new Error('Task execution changed');
      getSqliteDatabase().prepare('UPDATE personal_requests SET result_json = ?, result_run_id = ?, updated_at = ? WHERE request_id = ?')
        .run(JSON.stringify(result), run.id, Date.now(), request.requestId);
      return { content: [{ type: 'text', text: 'Result saved for delivery to the originating chat after this Task completes.' }], details: {} };
    } };
}

export function createPersonalRequestConnectionTool(conversationId: () => string | undefined): AgentTool {
  return { name: 'personal_request_connection', label: 'Restore connected-app access', parameters: Type.Object({}),
    description: 'If the selected account is disconnected or expired, pause this Personal request and show reconnection in the originating main chat. Do not use this for missing tool schemas or unsupported operations. Stop work after the connection requirement is saved.',
    async execute() {
      const id = conversationId();
      if (!id) throw new Error('No active conversation');
      const { requirePersonalWorkerConnection, publishPersonalRequest } = await import('../../personal-agent/request-service.js');
      const request = requirePersonalWorkerConnection(id);
      publishPersonalRequest(request);
      return { content: [{ type: 'text', text: 'Waiting for the selected app account to be reconnected in the main chat. Stop this turn; the Task will resume automatically.' }], details: {} };
    } };
}
