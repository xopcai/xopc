import type { PrepareAutomationAgentSessionInput } from '../automations/index.js';
import type { ProjectService } from '../projects/index.js';
import type { SessionStore } from '../session/index.js';

export async function prepareAutomationAgentSession(
  store: SessionStore,
  projects: ProjectService,
  input: PrepareAutomationAgentSessionInput,
): Promise<void> {
  await store.resolveTranscriptPath(input.sessionKey, {
    metadata: {
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

  const current = await store.getMetadata(input.sessionKey);
  await store.updateMetadata(input.sessionKey, {
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
    },
  });

  if (input.projectId) {
    projects.attachSession(input.sessionKey, input.projectId);
  } else if (current?.projectId) {
    projects.detachSession(input.sessionKey);
  }
}
