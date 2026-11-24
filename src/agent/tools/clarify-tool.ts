import type { ClarificationPresentation } from '@xopcai/gateway-contract';
import { clarifyToolInputV2Schema, normalizeClarificationQuestion } from '@xopcai/gateway-contract';
import { Type } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';

const ChoiceSchema = Type.Object({
  id: Type.String(),
  label: Type.String({ description: 'Short, scannable option title (aim for 2–10 characters / 1–4 words).' }),
  description: Type.Optional(Type.String({ description: 'Optional 1-phrase trade-off or detail (<= 25 chars). Omit when the label is already clear.' })),
}, { additionalProperties: false });
const QuestionSchema = Type.Union([
  Type.Object({
    id: Type.String(),
    header: Type.String({ description: 'Short 1–3 word topic tag (2–6 Chinese chars) for step navigation.' }),
    question: Type.String({ description: 'One direct, concise question (<= 35 Chinese chars / <= 18 words). Do not list options in the question.' }),
    type: Type.Literal('text'),
  }, { additionalProperties: false }),
  Type.Object({
    id: Type.String(),
    header: Type.String({ description: 'Short 1–3 word topic tag (2–6 Chinese chars) for step navigation.' }),
    question: Type.String({ description: 'One direct, concise question (<= 35 Chinese chars / <= 18 words). Do not repeat choices inside the question.' }),
    type: Type.Literal('single_choice'),
    choices: Type.Array(ChoiceSchema, { minItems: 2, maxItems: 10, description: 'Prefer 2–4 distinct choices. Do not include an "Other/Custom" choice; the UI provides custom input natively.' }),
    recommendedChoiceId: Type.Optional(Type.String()),
  }, { additionalProperties: false }),
]);

const ClarifySchema = Type.Object({
  question: Type.Optional(Type.String({
    description: 'One direct, concise question (<= 35 Chinese chars / <= 18 words). Put background context in your normal message, not here, and never repeat choices inside the question.',
  })),
  interactionMode: Type.Optional(Type.Union([Type.Literal('quick'), Type.Literal('compose')], { description: 'quick submits a choice immediately; compose lets the user select and add details before submitting.' })),
  choiceDetails: Type.Optional(Type.Array(Type.Object({
    id: Type.String(),
    label: Type.String({ description: 'Short, scannable option title (aim for 2–10 characters / 1–4 words).' }),
    description: Type.Optional(Type.String({ description: 'Optional 1-phrase nuance (<= 25 chars). Omit if self-explanatory.' })),
  }), { minItems: 2, maxItems: 10, description: 'Prefer 2–4 clear, mutually exclusive choices with stable IDs. Never add an "Other/Custom" option (the UI includes it automatically).' })),
  recommendedChoiceId: Type.Optional(Type.String()),
  schemaVersion: Type.Optional(Type.Literal(2)),
  questions: Type.Optional(Type.Array(QuestionSchema, { minItems: 1, maxItems: 3, description: '1–3 independent decisions answered together. Use 1 question when possible. Supported by capable Web/Electron/Mobile main chats and delegated MCP runs. Never use for approvals.' })),
}, { additionalProperties: false, anyOf: [{ required: ['question'] }, { required: ['schemaVersion', 'questions'] }] });

export type ClarifyRequestPayload = ClarificationPresentation & {
  kind?: 'approval';
  question: string;

  /** Stable hash of the exact operation guarded by an approval. */
  approvalKey?: string;
  deviceInteraction?: import('@xopcai/gateway-contract').DeviceInteractionCheckpoint;
};

export type ClarifyRequestResult =
  | { status: 'answered'; answer: string }
  | { status: 'waiting'; waitId: string; expiresAt?: number };

export type GatewayClarifyRequestFn = (
  context: { conversationId: string; runId: string; toolCallId: string },
  request: ClarifyRequestPayload,
) => Promise<ClarifyRequestResult>;

export interface ClarifyToolDeps {
  /** Resolve a per-turn callback; returns null when clarification is unavailable. */
  resolveAskUser: (
    toolCallId: string,
  ) => ((request: ClarifyRequestPayload) => Promise<ClarifyRequestResult>) | null;
}

function waitForAbort(signal: AbortSignal | undefined): Promise<never> {
  return new Promise((_, reject) => {
    if (!signal) {
      return;
    }
    if (signal.aborted) {
      reject(new Error('aborted'));
      return;
    }
    signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  });
}

type ClarifyParams = Omit<ClarifyRequestPayload, 'kind' | 'approval' | 'approvalKey'>;

export function createClarifyTool(deps: ClarifyToolDeps): AgentTool {
  return {
    name: 'clarify',
    label: '❓ Clarify',
    description:
      'Ask the user a clarifying question and pause the objective until they respond.\n\n' +
      'Use this when you need more information to proceed correctly, rather than guessing.\n\n' +
      'WHEN TO USE:\n' +
      '- Ambiguous instructions with multiple valid interpretations\n' +
      '- Missing critical information (which file, which approach, etc.)\n' +
      '- Confirming destructive or irreversible actions\n\n' +
      'WHEN NOT TO USE:\n' +
      '- When you can reasonably infer the answer from context\n' +
      '- For trivial decisions that do not affect the task\n' +
      '- When the user explicitly said "just do it" or "your choice"\n\n' +
      'WRITING & STRUCTURE RULES (strictly follow to minimize user reading effort):\n' +
      '- Keep each question to one crisp sentence (aim for <= 35 Chinese chars or <= 18 words); never repeat options inside the question\n' +
      '- Use 2–4 distinct, scannable choices whenever possible; keep labels short (2–10 chars / 1–4 words)\n' +
      '- Add choice descriptions only when the label alone is ambiguous (<= 1 short phrase)\n' +
      '- Never include an "Other / Custom" choice — the UI natively provides custom input\n' +
      '- Set recommendedChoiceId when one option is clearly the best default\n' +
      '- Combine into 1 question whenever possible; use multi-question (v2) only for 2–3 genuinely independent decisions',
    parameters: ClarifySchema,

    async execute(
      toolCallId: string,
      params: any,
      signal?: AbortSignal,
    ): Promise<AgentToolResult<{ answer: string; waitId?: string; status?: 'waiting' }>> {
      const p = params as ClarifyParams;
      const askUser = deps.resolveAskUser(toolCallId);
      if (!askUser) {
        return {
          content: [
            {
              type: 'text',
              text: 'Clarification is not available in this environment. Proceed with the best safe assumption or explain what is missing.',
            },
          ],
          details: { answer: '' },
        };
      }

      const batch = params?.schemaVersion === 2 ? clarifyToolInputV2Schema.parse(params) : undefined;
      const payload: ClarifyRequestPayload = normalizeClarificationQuestion(batch ? {
        ...batch, question: batch.questions.map(q => q.header).join(' / '),
      } : {
        interactionMode: p.interactionMode,
        choiceDetails: p.choiceDetails,
        recommendedChoiceId: p.recommendedChoiceId,
        question: p.question,
      });

      try {
        const result = await Promise.race([
          askUser(payload),
          waitForAbort(signal),
        ]);

        if (result.status === 'waiting') {
          return {
            content: [{ type: 'text', text: 'Waiting for the user to answer this clarification. End the current run now.' }],
            details: { answer: '', waitId: result.waitId, status: result.status },
          };
        }

        return {
          content: [{ type: 'text', text: `User answered: ${result.answer}` }],
          details: { answer: result.answer },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        if (message === 'aborted') {
          return {
            content: [{ type: 'text', text: 'Clarification cancelled (run aborted).' }],
            details: { answer: '' },
          };
        }

        return {
          content: [{ type: 'text', text: `Could not get clarification: ${message}` }],
          details: { answer: '' },
        };
      }
    },
  } as any;
}
