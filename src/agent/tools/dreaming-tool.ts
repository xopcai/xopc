import { Type } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';

import type { Config } from '../../config/schema.js';
import {
  getMemoryReadiness,
  isXopcDatabaseOpen,
  listDreamingRuns,
  listMemorySignals,
} from '../../storage/sqlite/index.js';
import { evaluateMemoryReadiness } from '../../user-context/memory-readiness.js';
import { resolveDreamingConfig } from '../memory/dreaming/config.js';

const DreamingSchema = Type.Object({ action: Type.Literal('status') });

export interface DreamingToolDeps {
  getWorkspace: () => string;
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
      const workspaceId = deps.getWorkspace();
      const readiness = agentId && isXopcDatabaseOpen()
        ? getMemoryReadiness({ agentId, workspaceId })
        : evaluateMemoryReadiness({
            evaluatedTurns: 0,
            helpfulTurns: 0,
            recordFeedback: 0,
            recordErrors: 0,
            sensitiveFeedback: 0,
            dreamingRuns: 0,
            dreamingFailures: 0,
          });
      const resolved = resolveDreamingConfig(deps.getConfig(), { automaticReady: readiness.ready });
      const signals = listMemorySignals({ workspaceId, limit: 500 });
      const runs = listDreamingRuns({ agentId, workspaceId, limit: 20 });
      const text = JSON.stringify({
        mode: resolved.mode,
        phases: resolved.phases,
        writeDisposition: resolved.writeDisposition,
        readiness,
        storage: 'sqlite://memory_records',
        signalCount: signals.length,
        dreamingSignalCount: signals.filter((signal) => signal.source === 'dreaming').length,
        lastRun: runs[0] ?? null,
      }, null, 2);
      return { content: [{ type: 'text', text }], details: {} };
    },
  } as any;
}
