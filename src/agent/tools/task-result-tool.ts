import type { AgentTool } from '@earendil-works/pi-agent-core';
import { Type } from '@sinclair/typebox';

import { submitTaskResearchResult, type TaskResearchSubmission } from '../../tasks/task-research-result.js';

const id = Type.String({ minLength: 1, maxLength: 120 });
const schema = Type.Object({
  finalArtifactIds: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { maxItems: 50, uniqueItems: true })),
  mode: Type.Optional(Type.Union([Type.Literal('replace'), Type.Literal('amend')])),
  retireClaimIds: Type.Optional(Type.Array(id, { maxItems: 40 })),
  sources: Type.Array(Type.Object({ id, toolCallId: Type.Optional(Type.String()),
    excerpt: Type.Optional(Type.String({ minLength: 1, maxLength: 2000 })),
    excerptRange: Type.Optional(Type.Object({ start: Type.Integer({ minimum: 0 }), end: Type.Integer({ minimum: 1 }) }, { additionalProperties: false })),
    url: Type.Optional(Type.String()) }, { additionalProperties: false,
      oneOf: [{ required: ['excerpt'], not: { required: ['excerptRange'] } },
        { required: ['toolCallId', 'excerptRange'], not: { required: ['excerpt'] } }] }), { minItems: 1, maxItems: 40 }),
  claims: Type.Array(Type.Object({ id, statement: Type.String({ minLength: 1, maxLength: 2000 }),
    kind: Type.Union([Type.Literal('fact'), Type.Literal('inference'), Type.Literal('recommendation')]),
    sourceIds: Type.Array(id, { minItems: 1, maxItems: 8 }) }, { additionalProperties: false }), { minItems: 1, maxItems: 40 }),
}, { additionalProperties: false });

export function createTaskResultTool(getConversationId: () => string | undefined): AgentTool {
  return {
    name: 'publish_task_result', label: 'Publish research conclusions', parameters: schema,
    description: 'For sources prefer toolCallId plus excerptRange {start,end} copied from evidence receipts, and OMIT excerpt. Ranges use Unicode character offsets, at most 1000 characters; the host extracts the original successful read exactly so code escapes and commands cannot corrupt quotes. Supply exactly one of excerptRange or a short exact excerpt. Never include the input command as output. When this execution published files, finalArtifactIds is required: explicitly select the exact artifact IDs from publication receipts for the final delivery. Exclude intermediate, failed, obsolete and unrelated files. [] explicitly selects a text-only final result. New submissions replace this final selection; no historical union. Submit Task research evidence for per-criterion review; publish required files first. Initial submission creates the ledger; subsequent submissions default to amend so earlier evidence is retained. Use explicit replace only for a complete replacement ledger. During repair retain stable source/claim IDs, update targeted claims and retire obsolete/wrong claim IDs with retireClaimIds. All retained claims are reviewed again. Reviewer support/note/checks fields are read-only; never send them back in sources or claims. Never drop valid calculation/input evidence merely to fix a file. Negative assertions such as "never reran a script" need an observable, scoped execution record; do not invent proof of absence or add an unnecessary absolute negative claim. Keep prohibitions as constraints, and retire unsupported optional claims while retaining required verified findings. Sources require short contiguous exact excerpts from successful read_file/read_media/web/exec/session_status results or publication receipts in this TaskRun. Never concatenate passages, invent call IDs, or cite an earlier review as factual evidence. Use task_collaboration get section evidence to list/read original toolCallIds. Your planned final reply is not evidence and should not become a claim about future delivery. On source_quote_mismatch follow the recovery instruction; never repeat unchanged sources. Prefer original inputs; the host reads published reports/scripts. URL is optional; actual web metadata is preserved. Claims reference source IDs and distinguish fact/inference/recommendation. Publication receipts prove availability, not prices. This binds provenance and runs model review, not independent fact certification. Resubmit changed evidence or adopted directions; do not endlessly repeat unchanged data when review is unavailable. Do not use outside a Task.',
    supportsParallel: false, mutationScope: 'none', idempotent: false,
    async execute(toolCallId: string, input: TaskResearchSubmission, signal?: AbortSignal) {
      const conversationId = getConversationId();
      if (!conversationId) throw new Error('Task conversation is required');
      const research = await submitTaskResearchResult(conversationId, toolCallId, input, signal);
      const readyForCompletion = research.checks.length > 0 && research.checks.every(check => check.status === 'passed')
        && (research.instructionChecks ?? []).every(check => check.status === 'passed') && research.claims.every(claim => claim.support === 'supported');
      return { content: [{ type: 'text', text: JSON.stringify({ saved: true, readyForCompletion,
        ...(readyForCompletion ? {} : { nextAction: 'The saved ledger is not fully verified. Before finishing, amend evidence for required unsupported findings; retire optional unsupported claims with retireClaimIds while preserving valid required evidence. Do not replay completed or uncertain operations just to change the ledger. If a required finding cannot be verified safely, retain an honest partial result.' }), review: research.review,
        claims: research.claims, checks: research.checks, instructionChecks: research.instructionChecks }) }], details: { research } };
    },
  } as AgentTool;
}
