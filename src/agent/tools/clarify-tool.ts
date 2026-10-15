import type { ClarificationPresentation } from '@xopcai/gateway-contract';
import { Type } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';

const ClarifySchema = Type.Object({
  question: Type.String({
    description: 'The question to ask the user. Be specific and concise.',
  }),
  interactionMode: Type.Optional(Type.Union([Type.Literal('quick'), Type.Literal('compose')], { description: 'quick submits a choice immediately; compose lets the user select and add details before submitting.' })),
  choiceDetails: Type.Optional(Type.Array(Type.Object({ id: Type.String(), label: Type.String(), description: Type.Optional(Type.String()) }), { minItems: 2, maxItems: 10, description: 'Answer choices with stable unique IDs and optional descriptions.' })),
  recommendedChoiceId: Type.Optional(Type.String()),
}, { additionalProperties: false });

export type ClarifyRequestPayload = ClarificationPresentation & {
  kind?: 'approval';
  question: string;

  /** Stable hash of the exact operation guarded by an approval. */
  approvalKey?: string;
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
      'TIPS:\n' +
      '- Provide choices when there are clear options (faster for the user)\n' +
      '- Keep questions short and specific\n' +
      '- Set recommendedChoiceId when one option is clearly more likely',
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

      const payload: ClarifyRequestPayload = {
        interactionMode: p.interactionMode,
        choiceDetails: p.choiceDetails,
        recommendedChoiceId: p.recommendedChoiceId,
        question: p.question,
      };

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
