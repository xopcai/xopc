import { Type } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';

import type { Config } from '../../config/schema.js';
import { listMemorySignals, listMemoryTraceEvents } from '../../storage/sqlite/index.js';
import { resolveDreamingConfig } from '../memory/dreaming/config.js';

const DreamingSchema = Type.Object({ action: Type.Literal('status') });

export interface DreamingToolDeps {
  getWorkspace: () => string;
  getDreamingRoot: () => string;
  getConfig: () => Config | undefined;
  getAgentId?: () => string | undefined;
}

export function createDreamingTool(deps: DreamingToolDeps): AgentTool {
  return {
    name: 'dreaming',
    label: '💤 Dreaming',
    description: 'Show the structured Dreaming configuration and recent consolidation activity.',
    parameters: DreamingSchema,
    async execute(): Promise<AgentToolResult<{}>> {
      const agentId = deps.getAgentId?.();
      const resolved = resolveDreamingConfig(deps.getConfig(), agentId);
      const workspaceId = deps.getWorkspace();
      const signals = listMemorySignals({ workspaceId, limit: 500 });
      const traces = listMemoryTraceEvents({ sourceAgentId: agentId, limit: 100 })
        .filter((trace) => trace.phase.startsWith('dreaming_'));
      const text = JSON.stringify({
        enabled: resolved.enabled,
        phases: resolved.phases,
        promotionWritePolicy: resolved.promotionWritePolicy,
        storage: 'sqlite://memory_records',
        signalCount: signals.length,
        dreamingSignalCount: signals.filter((signal) => signal.source === 'dreaming').length,
        lastRun: traces[0] ?? null,
      }, null, 2);
      return { content: [{ type: 'text', text }], details: {} };
    },
  } as any;
}
