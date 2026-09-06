import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';

const APPLY_PATCH_BEGIN_MARKER = '*** Begin Patch';
const APPLY_PATCH_END_MARKER = '*** End Patch';

export type ApplyPatchEnvelopeError = {
  code: 'invalid_patch_envelope';
  field: 'patch';
  issue: 'missing_patch' | 'first_line' | 'control_line' | 'last_line';
  expected: string;
  received?: string;
  retryHint: string;
};

const TOOL_PROMPT_HINTS: Record<string, { promptSnippet?: string; promptGuidelines?: string[] }> = {
  read_file: {
    promptSnippet: 'Read targeted file contents',
    promptGuidelines: ['Use read_file to inspect source files before editing.'],
  },
  write_file: {
    promptSnippet: 'Create new files or intentional complete rewrites',
    promptGuidelines: ['Prefer apply_patch for code changes. Use write_file only for non-code artifacts or deliberate full-file rewrites.'],
  },
  apply_patch: {
    promptSnippet: 'Apply patches using the exact apply_patch envelope',
    promptGuidelines: [
      'Use apply_patch for source edits. Keep patches small and verify with exec_command.',
      'The patch must start exactly with `*** Begin Patch` and end exactly with `*** End Patch`.',
      'Patch control lines must not end in ` ***`; do not wrap the patch in a Markdown code fence or add prose.',
      'Use this shape: `*** Begin Patch\\n*** Update File: path\\n@@\\n-old\\n+new\\n*** End Patch`.',
      'If apply_patch rejects the envelope, regenerate the complete patch from this exact shape instead of repeating it.',
    ],
  },
  exec_command: {
    promptSnippet: 'Run tests, type checks, builds, package scripts, and safe inspection commands',
    promptGuidelines: ['Use exec_command for verification and safe inspection, not routine file editing.'],
  },
  update_plan: {
    promptSnippet: 'Update the visible multi-step coding plan',
    promptGuidelines: ['Use update_plan for multi-step coding work and keep the active step current.'],
  },
  grep: {
    promptSnippet: 'Search file contents for literals, errors, config values, and docs',
  },
  find: {
    promptSnippet: 'Find files by glob pattern',
  },
};

export function validateApplyPatchEnvelope(params: unknown): ApplyPatchEnvelopeError | null {
  if (!params || typeof params !== 'object' || Array.isArray(params)) {
    return {
      code: 'invalid_patch_envelope',
      field: 'patch',
      issue: 'missing_patch',
      expected: APPLY_PATCH_BEGIN_MARKER,
      retryHint: 'Pass a patch string beginning with the exact marker `*** Begin Patch`.',
    };
  }

  const patch = (params as { patch?: unknown }).patch;
  if (typeof patch !== 'string') {
    return {
      code: 'invalid_patch_envelope',
      field: 'patch',
      issue: 'missing_patch',
      expected: APPLY_PATCH_BEGIN_MARKER,
      retryHint: 'Pass a patch string beginning with the exact marker `*** Begin Patch`.',
    };
  }

  const lines = patch.split(/\r?\n/);
  const firstLine = lines[0] ?? '';
  if (firstLine !== APPLY_PATCH_BEGIN_MARKER) {
    return {
      code: 'invalid_patch_envelope',
      field: 'patch',
      issue: 'first_line',
      expected: APPLY_PATCH_BEGIN_MARKER,
      received: firstLine,
      retryHint: 'Use `*** Begin Patch` exactly. Do not add trailing ` ***`, prose, or a Markdown code fence.',
    };
  }

  const malformedControlLine = lines.slice(1, -1).find((line) => line.startsWith('*** ') && line.endsWith(' ***'));
  if (malformedControlLine) {
    return {
      code: 'invalid_patch_envelope',
      field: 'patch',
      issue: 'control_line',
      expected: malformedControlLine.slice(0, -4),
      received: malformedControlLine,
      retryHint: 'Patch control lines must not end in ` ***`. Remove the trailing stars from this control line.',
    };
  }

  const lastLine = lines.at(-1) ?? '';
  if (lastLine !== APPLY_PATCH_END_MARKER) {
    return {
      code: 'invalid_patch_envelope',
      field: 'patch',
      issue: 'last_line',
      expected: APPLY_PATCH_END_MARKER,
      received: lastLine,
      retryHint: 'End the patch with `*** End Patch` exactly. Do not add trailing ` ***` or prose.',
    };
  }

  return null;
}

function invalidApplyPatchEnvelopeResult(error: ApplyPatchEnvelopeError) {
  const received = error.received === undefined ? '' : ` Received: ${JSON.stringify(error.received)}.`;
  return {
    content: [{
      type: 'text' as const,
      text: `apply_patch input rejected (${error.issue}). Expected: ${error.expected}.${received} ${error.retryHint} Use this exact envelope:\n${APPLY_PATCH_BEGIN_MARKER}\n*** Update File: path\n@@\n-old\n+new\n${APPLY_PATCH_END_MARKER}`,
    }],
    details: { ...error, status: 'failed' },
  };
}

/** Map xopc {@link AgentTool} instances to pi-coding-agent {@link ToolDefinition}s for `createAgentSession`. */
export function xopcToolsToDefinitions(tools: AgentTool[]): ToolDefinition[] {
  return tools.map((tool) => {
    const promptHints = TOOL_PROMPT_HINTS[tool.name];
    const def = {
      name: tool.name,
      label: tool.label ?? tool.name,
      description: tool.description ?? tool.name,
      ...(promptHints?.promptSnippet ? { promptSnippet: promptHints.promptSnippet } : {}),
      ...(promptHints?.promptGuidelines ? { promptGuidelines: promptHints.promptGuidelines } : {}),
      parameters: tool.parameters,
      async execute(
        toolCallId: string,
        params: unknown,
        signal: AbortSignal | undefined,
        onUpdate: unknown,
      ) {
        if (tool.name === 'apply_patch') {
          const envelopeError = validateApplyPatchEnvelope(params);
          if (envelopeError) {
            return invalidApplyPatchEnvelopeResult(envelopeError) as never;
          }
        }

        return (tool as { execute: (...a: never[]) => unknown }).execute(
          toolCallId as never,
          params as never,
          signal as never,
          onUpdate as never,
        ) as never;
      },
    };
    return def as unknown as ToolDefinition;
  });
}
