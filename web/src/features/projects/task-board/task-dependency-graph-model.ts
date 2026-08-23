import type { ProjectTaskCard, ProjectTaskDependencyEdge } from '@xopcai/gateway-contract';

export type TaskGraphPosition = { x: number; y: number };

function adjacency(edges: ProjectTaskDependencyEdge[]) {
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();
  for (const edge of edges) {
    outgoing.set(edge.dependencyTaskId, [...(outgoing.get(edge.dependencyTaskId) ?? []), edge.dependentTaskId]);
    incoming.set(edge.dependentTaskId, [...(incoming.get(edge.dependentTaskId) ?? []), edge.dependencyTaskId]);
  }
  return { outgoing, incoming };
}

export function layoutTaskGraph(
  tasks: Pick<ProjectTaskCard, 'id' | 'updatedAt'>[],
  edges: ProjectTaskDependencyEdge[],
): Map<string, TaskGraphPosition> {
  const taskIds = new Set(tasks.map((task) => task.id));
  const graphEdges = edges.filter((edge) => taskIds.has(edge.dependencyTaskId) && taskIds.has(edge.dependentTaskId));
  const { outgoing, incoming } = adjacency(graphEdges);
  const indegree = new Map(tasks.map((task) => [task.id, incoming.get(task.id)?.length ?? 0]));
  const depth = new Map(tasks.map((task) => [task.id, 0]));
  const queue = tasks
    .filter((task) => indegree.get(task.id) === 0)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((task) => task.id);

  for (let index = 0; index < queue.length; index += 1) {
    const taskId = queue[index];
    for (const dependentId of outgoing.get(taskId) ?? []) {
      depth.set(dependentId, Math.max(depth.get(dependentId) ?? 0, (depth.get(taskId) ?? 0) + 1));
      const nextIndegree = (indegree.get(dependentId) ?? 1) - 1;
      indegree.set(dependentId, nextIndegree);
      if (nextIndegree === 0) queue.push(dependentId);
    }
  }

  const layers = new Map<number, string[]>();
  for (const task of tasks) {
    const layer = depth.get(task.id) ?? 0;
    layers.set(layer, [...(layers.get(layer) ?? []), task.id]);
  }
  const positions = new Map<string, TaskGraphPosition>();
  for (const [layer, taskIdsInLayer] of layers) {
    taskIdsInLayer.forEach((taskId, row) => positions.set(taskId, { x: layer * 300, y: row * 136 }));
  }
  return positions;
}

export function blockedChainTaskIds(
  tasks: Pick<ProjectTaskCard, 'id' | 'lane'>[],
  edges: ProjectTaskDependencyEdge[],
): Set<string> {
  const { incoming } = adjacency(edges);
  const included = new Set(tasks.filter((task) => task.lane === 'waiting').map((task) => task.id));
  const queue = [...included];
  for (let index = 0; index < queue.length; index += 1) {
    for (const dependencyId of incoming.get(queue[index]) ?? []) {
      if (included.has(dependencyId)) continue;
      included.add(dependencyId);
      queue.push(dependencyId);
    }
  }
  return included;
}

export function relatedTaskIds(taskId: string, edges: ProjectTaskDependencyEdge[]): Set<string> {
  const { incoming, outgoing } = adjacency(edges);
  const related = new Set([taskId]);
  for (const graph of [incoming, outgoing]) {
    const queue = [taskId];
    const visited = new Set(queue);
    for (let index = 0; index < queue.length; index += 1) {
      for (const neighbor of graph.get(queue[index]) ?? []) {
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        related.add(neighbor);
        queue.push(neighbor);
      }
    }
  }
  return related;
}
