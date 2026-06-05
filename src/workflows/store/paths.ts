import { join } from 'node:path';

import type { Config } from '../../config/schema.js';
import { resolveAgentHomeDir } from '../../config/paths.js';

export function resolveWorkflowRootDir(config: Config, agentId: string): string {
  return join(resolveAgentHomeDir(config, agentId), 'workflows');
}

export function resolveWorkflowRunsDir(config: Config, agentId: string): string {
  return join(resolveWorkflowRootDir(config, agentId), 'runs');
}

export function resolveWorkflowRunDir(config: Config, agentId: string, runId: string): string {
  return join(resolveWorkflowRunsDir(config, agentId), runId);
}

export function resolveWorkflowRunEventsPath(config: Config, agentId: string, runId: string): string {
  return join(resolveWorkflowRunDir(config, agentId, runId), 'events.jsonl');
}

export function resolveWorkflowRunViewPath(config: Config, agentId: string, runId: string): string {
  return join(resolveWorkflowRunDir(config, agentId, runId), 'view.json');
}

export function resolveWorkflowRunArtifactsDir(config: Config, agentId: string, runId: string): string {
  return join(resolveWorkflowRunDir(config, agentId, runId), 'artifacts');
}
