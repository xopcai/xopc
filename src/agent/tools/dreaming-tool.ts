import { Type } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';

import type { Config } from '../../config/schema.js';
import {
  listContextConsolidationRuns,
} from '../../storage/sqlite/index.js';
import { resolveContextConsolidationConfig } from '../../user-context/consolidation.js';

const DreamingSchema = Type.Object({ action: Type.Literal('status') });

export interface DreamingToolDeps {
  getConfig: () => Config | undefined;
}

export function createDreamingTool(deps: DreamingToolDeps): AgentTool {
  return {
    name: 'dreaming',
    label: '💤 Dreaming',
    description: 'Show structured user-context review configuration and recent activity.',
    parameters: DreamingSchema,
    async execute(): Promise<AgentToolResult<{}>> {
      const config = deps.getConfig();
      const resolved = config ? resolveContextConsolidationConfig(config) : null;
      const runs = listContextConsolidationRuns(20);
      const text = JSON.stringify({
        enabled: resolved?.enabled ?? false,
        schedule: resolved ? { time: resolved.time, timezone: resolved.timezone } : null,
        policy: 'review_only',
        storage: 'sqlite://user_understandings',
        lastRun: runs[0] ?? null,
      }, null, 2);
      return { content: [{ type: 'text', text }], details: {} };
    },
  } as AgentTool;
}
