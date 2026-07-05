import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';

const TOOL_PROMPT_HINTS: Record<string, { promptSnippet?: string; promptGuidelines?: string[] }> = {
  read_file: {
    promptSnippet: 'Read targeted file contents',
    promptGuidelines: ['Use read_file to inspect source files before editing.'],
  },
  edit_file: {
    promptSnippet: 'Make precise, minimal edits to existing files',
    promptGuidelines: ['Use edit_file for small source changes instead of rewriting whole files.'],
  },
  write_file: {
    promptSnippet: 'Create new files or intentional complete rewrites',
    promptGuidelines: ['Use write_file only for new files or deliberate full-file rewrites.'],
  },
  shell: {
    promptSnippet: 'Run tests, type checks, builds, package scripts, and safe inspection commands',
    promptGuidelines: ['Use shell for verification and safe inspection, not routine file editing.'],
  },
  grep: {
    promptSnippet: 'Search file contents for literals, errors, config values, and docs',
  },
  find: {
    promptSnippet: 'Find files by glob pattern',
  },
};

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
