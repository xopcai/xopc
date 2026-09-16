import { resolveConversationId } from '../../routing/session-key.js';

/** Stable webchat session key for one workflow run (`agent:{id}:webchat:…:direct:wf_{runId}`). */
export function buildWorkflowRunConversationId(agentId: string, runId: string): string {
  return resolveConversationId({
    agentId,
    source: 'webchat',
    accountId: 'default',
    peerKind: 'direct',
    peerId: `wf_${runId}`,
  });
}

export function readWorkflowRunIdFromSessionCustomData(
  customData: Record<string, unknown> | undefined,
): string | null {
  const raw = customData?.workflowRunId;
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
}
