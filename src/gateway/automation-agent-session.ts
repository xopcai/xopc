import type { PrepareAutomationAgentSessionInput } from '../automations/index.js';
import type { ProjectService } from '../projects/index.js';
import type { SessionStore } from '../session/index.js';

export async function prepareAutomationAgentSession(
  store: SessionStore,
  projects: ProjectService,
  input: PrepareAutomationAgentSessionInput,
): Promise<void> {
  const isSystemMemoryMaintenance = input.automationId.startsWith('system-memory-');
  await store.resolveTranscriptPath(input.conversationId, {
    metadata: {
      // Only seed new sessions; automation output makes them visible.
      hiddenFromSessionList: true,
      name: input.automationName,
      customData: {
        titleSource: 'provisional',
        deferVisibilityUntilOutput: true,
        ...(isSystemMemoryMaintenance ? { systemInternal: true } : {}),
      },
      projectId: input.projectId,
      sourceChannel: 'automation',
      sourceChatId: `default:dm:${input.peerId}`,
      sessionType: 'chat',
      routing: {
        agentId: input.agentId,
        source: 'automation',
        accountId: 'default',
        peerKind: 'dm',
        peerId: input.peerId,
      },
    },
  });

  const current = await store.getMetadata(input.conversationId);
  await store.updateMetadata(input.conversationId, {
    ...(isSystemMemoryMaintenance ? { hiddenFromSessionList: true } : {}),
    sourceChannel: 'automation',
    sourceChatId: `default:dm:${input.peerId}`,
    sessionType: 'chat',
    routing: {
      agentId: input.agentId,
      source: 'automation',
      accountId: 'default',
      peerKind: 'dm',
      peerId: input.peerId,
    },
    tags: [...new Set([...(current?.tags ?? []), 'automation'])],
    customData: {
      ...(current?.customData ?? {}),
      origin: 'automation',
      automationId: input.automationId,
      latestAutomationRunId: input.runId,
      ...(isSystemMemoryMaintenance ? { systemInternal: true } : {}),
    },
  });

  if (input.projectId) {
    projects.attachSession(input.conversationId, input.projectId);
  } else if (current?.projectId) {
    projects.detachSession(input.conversationId);
  }
}
