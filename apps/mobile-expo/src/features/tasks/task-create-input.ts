import type { TaskContextInput, TaskCreateRequest } from '@xopcai/gateway-contract';

import type { ChatAgentsPayload } from '../../query/agents';
import type { Project } from '../../query/projects';

export function resolveTaskAgentId({
  agents,
  project,
  selectedAgentId,
}: {
  agents: ChatAgentsPayload;
  project?: Project;
  selectedAgentId?: string;
}): string {
  const available = new Set(agents.items.map((agent) => agent.id));
  const candidates = [selectedAgentId, project?.defaultAgentId, agents.defaultId];
  const resolved = candidates.find((candidate) => candidate && available.has(candidate));
  if (!resolved) throw new Error('No available agent can execute this task');
  return resolved;
}

export function noteTaskContext(noteId: string | undefined, title: string): TaskContextInput[] {
  const id = noteId?.trim();
  if (!id) return [];
  return [{
    targetKind: 'document',
    targetId: id,
    role: 'input',
    title: title.trim() || undefined,
    pinned: true,
    retrievalPolicy: { mode: 'always' },
    metadata: { source: 'mobile_inbox' },
  }];
}

export function buildMobileTaskCreateRequest(input: {
  idempotencyKey: string;
  title: string;
  projectId?: string;
  dependencies: string[];
  agentId: string;
  noteId?: string;
  body?: string;
  acceptanceCriteria?: string[];
}): TaskCreateRequest {
  const title = input.title.trim();
  const body = input.body?.trim();
  const acceptanceCriteria = (input.acceptanceCriteria ?? []).map((item) => item.trim()).filter(Boolean);
  return {
    idempotencyKey: input.idempotencyKey,
    title,
    ...(body ? { body } : {}),
    projectId: input.projectId || undefined,
    priority: 'normal',
    contract: {
      objective: body || title,
      expectedOutputs: [],
      acceptanceCriteria,
      constraints: [],
      approvalRequired: [],
      assumptions: [],
      risks: [],
      acceptancePolicy: 'manual',
      outputDestinations: [],
    },
    dependencies: input.dependencies,
    context: noteTaskContext(input.noteId, title),
    authorityGrants: [],
    activation: { mode: 'start', executor: { kind: 'agent', agentId: input.agentId } },
  };
}
