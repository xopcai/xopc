import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import { Type } from '@sinclair/typebox';

import type { Config } from '../../config/schema.js';
import { listMemoryMaintenanceRuns, resolveMemoryMaintenanceSchedules } from '../../memory-maintenance/index.js';

const StatusSchema = Type.Object({ action: Type.Literal('status') });

export interface MemoryMaintenanceToolDeps {
  getConfig: () => Config | undefined;
}

export function createMemoryMaintenanceTool(deps: MemoryMaintenanceToolDeps): AgentTool {
  return {
    name: 'memory_maintenance',
    label: 'Memory maintenance',
    description: 'Show deterministic user-model and knowledge-memory maintenance schedules and runs.',
    parameters: StatusSchema,
    async execute(): Promise<AgentToolResult<{}>> {
      const config = deps.getConfig();
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            enabled: Boolean(config && resolveMemoryMaintenanceSchedules(config).length),
            schedules: config ? resolveMemoryMaintenanceSchedules(config) : [],
            policy: 'deterministic',
            recentRuns: listMemoryMaintenanceRuns(20),
          }, null, 2),
        }],
        details: {},
      };
    },
  } as AgentTool;
}
