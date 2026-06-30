import { createHash, randomUUID } from 'node:crypto';

import type { EffectiveAgentManifest } from '../agent-manifest/schema.js';

export type AgentRunStatus = 'running' | 'completed' | 'failed' | 'cancelled';

export type AgentRunEventType =
  | 'run.started'
  | 'model.selected'
  | 'tool.called'
  | 'memory.read'
  | 'memory.write.checked'
  | 'workflow.selected'
  | 'boundary.checked'
  | 'run.completed'
  | 'run.failed';

export interface AgentRunEvent {
  id: string;
  runId: string;
  type: AgentRunEventType;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface AgentRunTrace {
  id: string;
  agentId: string;
  status: AgentRunStatus;
  effectiveManifestHash: string;
  startedAt: string;
  endedAt?: string;
  events: AgentRunEvent[];
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .toSorted(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function hashEffectiveManifest(manifest: EffectiveAgentManifest): string {
  return createHash('sha256').update(stableJson(manifest)).digest('hex');
}

export function createAgentRunTrace(params: {
  agentId: string;
  manifest: EffectiveAgentManifest;
  now?: Date;
}): AgentRunTrace {
  const startedAt = (params.now ?? new Date()).toISOString();
  const runId = randomUUID();
  return {
    id: runId,
    agentId: params.agentId,
    status: 'running',
    effectiveManifestHash: hashEffectiveManifest(params.manifest),
    startedAt,
    events: [
      {
        id: randomUUID(),
        runId,
        type: 'run.started',
        payload: { agentId: params.agentId },
        createdAt: startedAt,
      },
    ],
  };
}

export function appendAgentRunEvent(
  trace: AgentRunTrace,
  type: AgentRunEventType,
  payload: Record<string, unknown>,
  now = new Date(),
): AgentRunTrace {
  if (trace.status !== 'running') {
    throw new Error(`Cannot append event to ${trace.status} run`);
  }
  return {
    ...trace,
    events: [
      ...trace.events,
      {
        id: randomUUID(),
        runId: trace.id,
        type,
        payload,
        createdAt: now.toISOString(),
      },
    ],
  };
}

export function finishAgentRunTrace(
  trace: AgentRunTrace,
  status: Exclude<AgentRunStatus, 'running'>,
  payload: Record<string, unknown> = {},
  now = new Date(),
): AgentRunTrace {
  if (trace.status !== 'running') {
    throw new Error(`Cannot finish ${trace.status} run`);
  }
  const eventType: AgentRunEventType = status === 'failed' ? 'run.failed' : 'run.completed';
  const next = appendAgentRunEvent(trace, eventType, payload, now);
  return {
    ...next,
    status,
    endedAt: now.toISOString(),
  };
}
