import { Type } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';

import { getToolManual, listToolManuals } from '../tool-manuals/index.js';

const ToolManualSchema = Type.Object({
  tool: Type.String({ description: 'Built-in tool name, e.g. browser_use' }),
});

export function createToolManualTool(): AgentTool<typeof ToolManualSchema, {}> {
  return {
    name: 'tool_manual',
    label: '📘 Tool Manual',
    description:
      'Load built-in usage manuals for complex tools. Use before non-trivial use of tools such as browser_use or xopc_use.',
    parameters: ToolManualSchema,
    async execute(_toolCallId, params): Promise<AgentToolResult<{}>> {
      const toolName = params.tool.trim();
      const manual = getToolManual(toolName);
      if (!manual) {
        const available = listToolManuals().map((m) => m.toolName);
        return {
          content: [
            {
              type: 'text',
              text: `No built-in manual found for tool: ${toolName}. Available manuals: ${available.join(', ') || 'none'}.`,
            },
          ],
          details: {},
        };
      }

      return {
        content: [{ type: 'text', text: manual.content }],
        details: {},
      };
    },
  };
}
