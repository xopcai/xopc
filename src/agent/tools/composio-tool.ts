import { Type } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';

import type { Config } from '../../config/schema.js';
import { canUseComposioAction, executeComposioTool } from '../../connectors/composio.js';

const ComposioExecuteSchema = Type.Object({
  slug: Type.String({ description: 'Composio action slug, e.g. GMAIL_FETCH_EMAILS or SLACK_SENDS_A_MESSAGE_TO_A_SLACK_CHANNEL.' }),
  arguments: Type.Optional(Type.Any({ description: 'Action arguments matching the Composio action schema.' })),
});

function hasInstalledComposioConnector(config: Config | undefined): boolean {
  return Object.entries(config?.connectors?.instances ?? {}).some(([id, record]) => (
    id.startsWith('composio-') &&
    id !== 'composio-api-key' &&
    Boolean(record && typeof record === 'object' && !Array.isArray(record))
  ));
}

export function createComposioExecuteTool(getConfig: () => Config | undefined): AgentTool<typeof ComposioExecuteSchema, {}> | null {
  if (!hasInstalledComposioConnector(getConfig())) {
    return null;
  }
  return {
    name: 'composio_execute',
    label: '🔌 Composio Execute',
    description: 'Execute an installed Composio integration action. Actions are gated by the connector curated allowlist and read/write/admin scope.',
    parameters: ComposioExecuteSchema,
    async execute(_toolCallId, params): Promise<AgentToolResult<{}>> {
      const config = getConfig();
      const allowed = canUseComposioAction(config, params.slug);
      if (allowed.ok === false) {
        return { content: [{ type: 'text', text: allowed.reason }], details: {} };
      }
      const result = await executeComposioTool({ slug: params.slug, arguments: params.arguments, config });
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        details: {},
      };
    },
  };
}
