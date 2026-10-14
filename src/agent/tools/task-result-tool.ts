import type { AgentTool } from '@earendil-works/pi-agent-core';
import { Type } from '@sinclair/typebox';

import { submitTaskResearchResult, type TaskResearchSubmission } from '../../tasks/task-research-result.js';

const id = Type.String({ minLength: 1, maxLength: 120 });
const schema = Type.Object({
  mode: Type.Optional(Type.Union([Type.Literal('replace'), Type.Literal('amend')])),
  retireClaimIds: Type.Optional(Type.Array(id, { maxItems: 40 })),
  sources: Type.Array(Type.Object({ id, toolCallId: Type.Optional(Type.String()),
    excerpt: Type.String({ minLength: 1, maxLength: 2000 }), url: Type.Optional(Type.String()) }), { minItems: 1, maxItems: 40 }),
  claims: Type.Array(Type.Object({ id, statement: Type.String({ minLength: 1, maxLength: 2000 }),
    kind: Type.Union([Type.Literal('fact'), Type.Literal('inference'), Type.Literal('recommendation')]),
    sourceIds: Type.Array(id, { minItems: 1, maxItems: 8 }) }), { minItems: 1, maxItems: 40 }),
}, { additionalProperties: false });

export function createTaskResultTool(getConversationId: () => string | undefined): AgentTool {
  return {
    name: 'publish_task_result', label: 'Publish research conclusions', parameters: schema,
    description: 'Submit Task research evidence for per-criterion review; publish required files first. Initial submission creates the ledger; subsequent submissions default to amend so earlier evidence is retained. Use explicit replace only for a complete replacement ledger. During repair retain stable source/claim IDs, update targeted claims and retire obsolete/wrong claim IDs with retireClaimIds. All retained claims are reviewed again. Never drop valid calculation/input evidence merely to fix a file. Sources require short contiguous exact excerpts from successful read_file/read_media/web/exec/session_status results or publication receipts in this TaskRun. Never concatenate passages, invent call IDs, or cite an earlier review as factual evidence. Prefer original inputs; the host reads published reports/scripts. URL is optional; actual web metadata is preserved. Claims reference source IDs and distinguish fact/inference/recommendation. Publication receipts prove availability, not prices. This binds provenance and runs model review, not independent fact certification. Resubmit changed evidence or adopted directions; do not endlessly repeat unchanged data when review is unavailable. Do not use outside a Task.',
    supportsParallel: false, mutationScope: 'none', idempotent: false,
    async execute(toolCallId: string, input: TaskResearchSubmission, signal?: AbortSignal) {
      const conversationId = getConversationId();
      if (!conversationId) throw new Error('Task conversation is required');
      const research = await submitTaskResearchResult(conversationId, toolCallId, input, signal);
      return { content: [{ type: 'text', text: JSON.stringify({ saved: true, review: research.review,
        claims: research.claims, checks: research.checks, instructionChecks: research.instructionChecks }) }], details: { research } };
    },
  } as AgentTool;
}
