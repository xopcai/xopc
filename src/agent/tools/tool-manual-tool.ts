import { Type } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';

import { xopcConfigurationTopics } from '../tool-manuals/xopc-configuration.js';
import { getToolManual, listToolManuals } from '../tool-manuals/index.js';

const ToolManualSchema = Type.Object({
  tool: Type.String({ description: 'Built-in tool name, e.g. browser_use' }),
  topic: Type.Optional(Type.Union([Type.Literal('agent'), Type.Literal('settings'), Type.Literal('automation'), Type.Literal('connections')], { description: 'Focused xopc_use workflow; omit for the full parameter manual.' })),
});

export function createToolManualTool(): AgentTool<typeof ToolManualSchema, {}> {
  return {
    name: 'tool_manual',
    label: '📘 Tool Manual',
    description:
      'Focused xopc_use workflows are available as topic agent, settings, automation or connections; omit topic for full parameters. Load built-in usage manuals for complex tools. Use before non-trivial use of tools such as browser_use or xopc_use.',
    parameters: ToolManualSchema,
    async execute(_toolCallId, params): Promise<AgentToolResult<{}>> {
      const toolName = params.tool.trim();
      if (params.topic) {
        if (toolName !== 'xopc_use') return { content: [{ type: 'text', text: 'Topics are supported only for xopc_use; omit topic for other manuals.' }], details: {} };
        return { content: [{ type: 'text', text: xopcConfigurationTopics[params.topic] }], details: {} };
      }
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
