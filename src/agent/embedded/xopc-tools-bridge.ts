import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';

/** Map xopc {@link AgentTool} instances to pi-coding-agent {@link ToolDefinition}s for `createAgentSession`. */
export function xopcToolsToDefinitions(tools: AgentTool[]): ToolDefinition[] {
  return tools.map((tool) => {
    const def = {
      name: tool.name,
      label: tool.label ?? tool.name,
      description: tool.description ?? tool.name,
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
