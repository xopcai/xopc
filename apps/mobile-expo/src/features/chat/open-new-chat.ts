import type { ResolvedNewSessionSpec, SessionInitialAgentConfig, LocalSessionOptions } from '@xopcai/gateway-contract';
import { createSession } from '../../query/sessions';

export function openNewChat(
  spec: Pick<ResolvedNewSessionSpec, 'agentId' | 'projectId'> & { executionMode?: LocalSessionOptions['executionMode'] },
  initialAgentConfig?: SessionInitialAgentConfig,
): Promise<string> {
  return createSession({ agentId: spec.agentId, projectId: spec.projectId ?? undefined,
    executionMode: spec.executionMode, initialAgentConfig });
}
