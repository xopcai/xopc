import { Type, type Static } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';

const ClarifySchema = Type.Object({
  question: Type.String({
    description: 'The question to ask the user. Be specific and concise.',
  }),
  choices: Type.Optional(
    Type.Array(Type.String(), {
      description:
        'Optional list of choices for multiple-choice questions. ' +
        'If provided, the user picks one. If omitted, the user types a free-form answer.',
      minItems: 2,
      maxItems: 10,
    }),
  ),
  default: Type.Optional(
    Type.String({
      description: 'Default answer if the user does not respond within timeout.',
    }),
  ),
});

export type ClarifyRequestPayload = {
  question: string;
  choices?: string[];
  default?: string;
};

export type GatewayClarifyRequestFn = (
  sessionKey: string,
  request: ClarifyRequestPayload,
) => Promise<string>;

export interface ClarifyToolDeps {
  /** Resolve a per-turn callback; returns null when clarification is unavailable. */
  resolveAskUser: () => ((request: ClarifyRequestPayload) => Promise<string>) | null;
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

export function createClarifyTool(deps: ClarifyToolDeps): AgentTool<
  typeof ClarifySchema,
  { answer: string }
> {
  return {
    name: 'clarify',
    label: '❓ Clarify',
    description:
      'Ask the user a clarifying question and wait for their response.\n\n' +
      'Use this when you need more information to proceed correctly, rather than guessing.\n\n' +
      'WHEN TO USE:\n' +
      '- Ambiguous instructions with multiple valid interpretations\n' +
      '- Missing critical information (which file, which approach, etc.)\n' +
      '- Confirming destructive or irreversible actions\n\n' +
      'WHEN NOT TO USE:\n' +
      '- When you can reasonably infer the answer from context\n' +
      '- For trivial decisions that do not affect the outcome\n' +
      '- When the user explicitly said "just do it" or "your choice"\n\n' +
      'TIPS:\n' +
      '- Provide choices when there are clear options (faster for the user)\n' +
      '- Keep questions short and specific\n' +
      '- Include a default when one option is clearly more likely',
    parameters: ClarifySchema,

    async execute(
      _toolCallId: string,
      params: Static<typeof ClarifySchema>,
      signal?: AbortSignal,
    ): Promise<AgentToolResult<{ answer: string }>> {
      const askUser = deps.resolveAskUser();
      if (!askUser) {
        if (params.default !== undefined && params.default !== '') {
          return {
            content: [
              {
                type: 'text',
                text: `Interactive clarification is not available in this environment. Using default: ${params.default}`,
              },
            ],
            details: { answer: params.default },
          };
        }
        return {
          content: [
            {
              type: 'text',
              text: 'Clarification is not available in this environment (no active webchat run). Provide a default or proceed with the best assumption.',
            },
          ],
          details: { answer: '' },
        };
      }

      const payload: ClarifyRequestPayload = {
        question: params.question,
        choices: params.choices,
        default: params.default,
      };

      try {
        const answer = await Promise.race([
          askUser(payload),
          waitForAbort(signal),
        ]);

        return {
          content: [{ type: 'text', text: `User answered: ${answer}` }],
          details: { answer },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        if (message === 'aborted') {
          return {
            content: [{ type: 'text', text: 'Clarification cancelled (run aborted).' }],
            details: { answer: params.default ?? '' },
          };
        }

        if (params.default !== undefined && params.default !== '' && message.toLowerCase().includes('timeout')) {
          return {
            content: [
              {
                type: 'text',
                text: `User did not respond in time. Using default: ${params.default}`,
              },
            ],
            details: { answer: params.default },
          };
        }

        return {
          content: [{ type: 'text', text: `Could not get clarification: ${message}` }],
          details: { answer: '' },
        };
      }
    },
  };
}
