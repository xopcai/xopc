/**
 * `structured_output` — terminating tool used to capture a subagent's final result.
 *
 * Injected into a subagent's toolset only when the workflow script asked for
 * structured output via `agent(prompt, { schema })`. The subagent is instructed
 * to invoke this tool exactly once with its final result; the tool sets
 * `terminate: true` so the agent loop stops without paying for an extra
 * assistant turn.
 *
 * Validation is done with ajv (already a xopc dep). pi-agent-core also validates
 * arguments against `parameters` before calling `execute`, but we re-check here
 * to (1) surface a clear error message back to the model when the schema is
 * non-trivial, and (2) avoid trusting the upstream layer's validator strictness.
 *
 * Note: the file is named `structured-output-tool.ts` to avoid clashing with the
 * existing `src/agent/tools/structured-output.ts` (an XML Element builder — a
 * completely unrelated utility).
 */

import Ajv, { type ValidateFunction } from 'ajv';
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import type { TSchema } from '@sinclair/typebox';

import type { JsonSchema } from './types.js';

export const STRUCTURED_OUTPUT_TOOL_NAME = 'structured_output';

export interface StructuredOutputCapture<T = unknown> {
  called: boolean;
  value?: T;
}

export interface CreateStructuredOutputToolOptions<T = unknown> {
  schema: JsonSchema;
  capture: StructuredOutputCapture<T>;
  /** Override the tool name (rarely needed; default `structured_output`). */
  name?: string;
}

// One Ajv instance per schema is fine — Ajv caches compiled validators internally.
// We re-use a singleton to avoid the per-call construction cost.
const ajv = new Ajv({ allErrors: true, strict: false });

export function createStructuredOutputTool<T = unknown>(
  options: CreateStructuredOutputToolOptions<T>,
): AgentTool<TSchema, T> {
  const name = options.name ?? STRUCTURED_OUTPUT_TOOL_NAME;
  const validator: ValidateFunction = ajv.compile(options.schema);

  return {
    name,
    label: 'Structured Output',
    description:
      'Return the final machine-readable result for this subagent task. ' +
      'Call this tool exactly once when finished. Do not emit a prose final answer afterwards.',
    parameters: options.schema as unknown as TSchema,
    async execute(
      _toolCallId: string,
      params: unknown,
    ): Promise<AgentToolResult<T>> {
      const valid = validator(params);
      if (!valid) {
        const reason = ajv.errorsText(validator.errors, { separator: '; ' });
        // Do NOT terminate on invalid input — let the model retry within the same run.
        return {
          content: [
            {
              type: 'text',
              text: `structured_output: invalid arguments — ${reason}. Adjust and call structured_output again.`,
            },
          ],
          details: params as T,
        };
      }
      options.capture.called = true;
      options.capture.value = params as T;
      return {
        content: [{ type: 'text', text: 'Structured output received.' }],
        details: params as T,
        terminate: true,
      };
    },
  };
}
