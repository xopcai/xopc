import type { TaskAggregate } from '../../tasks/task-repository.js';
import type { AgentSourceContext } from './types.js';

export function buildTaskAgentContext(task: TaskAggregate | undefined, expectedVersion?: string): AgentSourceContext | null {
  if (!task || (expectedVersion && expectedVersion !== String(task.version))) return null;
  const text = JSON.stringify({
    title: task.title,
    body: task.body,
    phase: task.phase,
    resolution: task.resolution,
    priority: task.priority,
    dueAt: task.dueAt,
    contract: task.contract,
  }, null, 2);
  const limit = 24_000;
  return {
    kind: 'task', sourceId: task.id, version: String(task.version), title: task.title,
    text: text.slice(0, limit), truncated: text.length > limit,
  };
}
