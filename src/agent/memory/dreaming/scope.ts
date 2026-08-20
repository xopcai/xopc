import type { Config } from '../../../config/schema.js';
import { getMemoryReadiness, isXopcDatabaseOpen } from '../../../storage/sqlite/index.js';
import { evaluateMemoryReadiness, type MemoryReadiness } from '../../../user-context/memory-readiness.js';
import {
  normalizeAgentId,
  resolveAgentWorkspaceDir,
  resolveDefaultAgentId,
} from '../../agent-scope.js';
import type { DreamingResolvedConfig } from './config.js';
import { resolveDreamingConfig } from './config.js';

export type DreamingAgentScope = {
  agentId: string;
  workspaceDir: string;
  config: DreamingResolvedConfig;
  readiness: MemoryReadiness;
  memory: Config['userContext']['memory'];
};

export function resolveDreamingAgentScope(config: Config, requestedAgentId?: string | null): DreamingAgentScope {
  const agentId = normalizeAgentId(requestedAgentId || resolveDefaultAgentId(config));
  const workspaceDir = resolveAgentWorkspaceDir(config, agentId);
  const readiness = isXopcDatabaseOpen()
    ? getMemoryReadiness({ agentId, workspaceId: workspaceDir })
    : evaluateMemoryReadiness({
        evaluatedTurns: 0,
        helpfulTurns: 0,
        recordFeedback: 0,
        recordErrors: 0,
        sensitiveFeedback: 0,
        dreamingRuns: 0,
        dreamingFailures: 0,
      });
  return {
    agentId,
    workspaceDir,
    config: resolveDreamingConfig(config, { automaticReady: readiness.ready }),
    readiness,
    memory: config.userContext.memory,
  };
}
