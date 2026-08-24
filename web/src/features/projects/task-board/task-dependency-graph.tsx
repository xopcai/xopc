import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { ProjectTaskCard, ProjectTaskDependencyEdge, TaskPhase } from '@xopcai/gateway-contract';
import { ExternalLink, Focus, Hourglass } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { taskDetailModalHref } from '@/features/tasks/task-detail-route';
import { cn } from '@/lib/cn';

import { blockedChainTaskIds, layoutTaskGraph, relatedTaskIds } from './task-dependency-graph-model';

export type TaskDependencyGraphCopy = {
  showCompleted: string;
  hideCompleted: string;
  blockedChains: string;
  allTasks: string;
  locateTask: string;
  openTask: string;
  empty: string;
  hint: string;
  blockedBy: string;
  phases: Record<TaskPhase, string>;
};

interface TaskNodeData extends Record<string, unknown> {
  task: ProjectTaskCard;
  phaseLabel: string;
  dimmed: boolean;
}

type TaskFlowNode = Node<TaskNodeData>;

const NODE_TONES: Record<TaskPhase, string> = {
  backlog: 'border-edge',
  ready: 'border-edge',
  active: 'border-accent ring-2 ring-accent/15',
  review: 'border-amber-400/80',
  closed: 'border-emerald-400/60',
};

function TaskNodeCard({ data, selected }: NodeProps<TaskFlowNode>) {
  const task = data.task;
  const isWaiting = task.operationalState === 'waiting' || task.operationalState === 'blocked';
  return (
    <div className={cn(
      'w-56 rounded-xl border bg-surface-panel p-3 shadow-surface transition-opacity',
      NODE_TONES[task.phase],
      selected && 'ring-2 ring-accent/30',
      data.dimmed && 'opacity-30',
    )}>
      <Handle type="target" position={Position.Left} className="!invisible" />
      <div className="flex items-start justify-between gap-2">
        <strong className="line-clamp-2 min-w-0 text-sm font-medium leading-5 text-fg">{task.title}</strong>
        {isWaiting ? <Hourglass className="mt-0.5 size-3.5 shrink-0 text-violet-600 dark:text-violet-300" aria-hidden /> : null}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-fg-subtle">
        <span>{data.phaseLabel}</span>
        {isWaiting && task.blockedBy.length > 0 ? <span>{task.blockedBy.length}</span> : null}
      </div>
      <Handle type="source" position={Position.Right} className="!invisible" />
    </div>
  );
}

const TASK_NODE_TYPES = { taskNode: TaskNodeCard };

export function TaskDependencyGraph({ tasks, dependencyEdges, returnTo, copy }: {
  tasks: ProjectTaskCard[];
  dependencyEdges: ProjectTaskDependencyEdge[];
  returnTo: string;
  copy: TaskDependencyGraphCopy;
}) {
  const [showCompleted, setShowCompleted] = useState(false);
  const [blockedOnly, setBlockedOnly] = useState(false);
  const [selectedId, setSelectedId] = useState<string>();
  const flowRef = useRef<ReactFlowInstance<TaskFlowNode, Edge> | null>(null);
  const blockedChain = useMemo(() => blockedChainTaskIds(tasks, dependencyEdges), [dependencyEdges, tasks]);
  const visibleTasks = useMemo(() => blockedOnly
    ? tasks.filter((task) => blockedChain.has(task.id))
    : showCompleted ? tasks : tasks.filter((task) => task.phase !== 'closed'),
  [blockedChain, blockedOnly, showCompleted, tasks]);
  const visibleIds = useMemo(() => new Set(visibleTasks.map((task) => task.id)), [visibleTasks]);
  const visibleEdges = useMemo(() => dependencyEdges.filter((edge) =>
    visibleIds.has(edge.dependencyTaskId) && visibleIds.has(edge.dependentTaskId)), [dependencyEdges, visibleIds]);
  const positions = useMemo(() => layoutTaskGraph(visibleTasks, visibleEdges), [visibleEdges, visibleTasks]);
  const related = useMemo(() => selectedId ? relatedTaskIds(selectedId, visibleEdges) : undefined, [selectedId, visibleEdges]);
  const selectedTask = visibleTasks.find((task) => task.id === selectedId);
  const taskById = useMemo(() => new Map(visibleTasks.map((task) => [task.id, task])), [visibleTasks]);
  const nodes = useMemo<TaskFlowNode[]>(() => visibleTasks.map((task) => ({
    id: task.id,
    type: 'taskNode',
    position: positions.get(task.id) ?? { x: 0, y: 0 },
    data: { task, phaseLabel: copy.phases[task.phase], dimmed: Boolean(related && !related.has(task.id)) },
  })), [copy.phases, positions, related, visibleTasks]);
  const edges = useMemo<Edge[]>(() => visibleEdges.map((edge) => {
    const dependency = taskById.get(edge.dependencyTaskId);
    const satisfied = dependency?.phase === 'closed' && dependency.resolution === 'done';
    const dimmed = Boolean(related && (!related.has(edge.dependencyTaskId) || !related.has(edge.dependentTaskId)));
    return {
      id: `${edge.dependencyTaskId}:${edge.dependentTaskId}`,
      source: edge.dependencyTaskId,
      target: edge.dependentTaskId,
      markerEnd: { type: MarkerType.ArrowClosed },
      style: {
        stroke: satisfied ? 'var(--color-edge-strong)' : 'var(--color-accent)',
        strokeWidth: satisfied ? 1.25 : 1.75,
        opacity: dimmed ? 0.18 : 1,
        strokeDasharray: satisfied ? '5 5' : undefined,
      },
    };
  }), [related, taskById, visibleEdges]);

  useEffect(() => {
    if (selectedId && !visibleIds.has(selectedId)) setSelectedId(undefined);
  }, [selectedId, visibleIds]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      void flowRef.current?.fitView({ padding: 0.2, minZoom: 0.35, maxZoom: 1, duration: 250 });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [blockedOnly, showCompleted, visibleTasks.length]);

  const locateSelected = () => {
    if (!selectedId) return;
    void flowRef.current?.fitView({ nodes: [{ id: selectedId }], padding: 1.5, minZoom: 0.7, maxZoom: 1, duration: 250 });
  };

  return (
    <section className="overflow-hidden rounded-xl border border-edge bg-surface-base/40">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-edge bg-surface-panel px-3 py-2.5">
        <p className="text-xs text-fg-muted">{copy.hint}</p>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button type="button" variant={blockedOnly ? 'secondary' : 'ghost'} className="h-8 rounded-lg px-2.5 text-xs" aria-pressed={blockedOnly} onClick={() => setBlockedOnly((value) => !value)}>
            {blockedOnly ? copy.allTasks : copy.blockedChains}
          </Button>
          <Button type="button" variant="ghost" className="h-8 rounded-lg px-2.5 text-xs" aria-pressed={showCompleted} onClick={() => setShowCompleted((value) => !value)} disabled={blockedOnly}>
            {showCompleted ? copy.hideCompleted : copy.showCompleted}
          </Button>
          {selectedTask ? (
            <Button type="button" variant="ghost" className="h-8 rounded-lg px-2.5 text-xs" onClick={locateSelected}>
              <Focus className="size-3.5" aria-hidden />
              {copy.locateTask}
            </Button>
          ) : null}
        </div>
      </div>
      {visibleTasks.length > 0 ? (
        <div className={cn('grid h-[min(42rem,calc(100vh-14rem))] min-h-[28rem]', selectedTask && 'lg:grid-cols-[minmax(0,1fr)_18rem]')}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={TASK_NODE_TYPES}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable
            onNodeClick={(_event, node) => setSelectedId(node.id)}
            onPaneClick={() => setSelectedId(undefined)}
            onInit={(instance) => { flowRef.current = instance; }}
            fitView
            minZoom={0.25}
            maxZoom={1.25}
            panOnScroll
            zoomOnDoubleClick={false}
            proOptions={{ hideAttribution: true }}
          >
            <Background color="var(--color-edge)" gap={22} size={1} />
            <Controls showInteractive={false} className="!border-edge !bg-surface-panel !shadow-surface" />
          </ReactFlow>
          {selectedTask ? (
            <aside className="overflow-y-auto border-t border-edge bg-surface-panel p-4 lg:border-l lg:border-t-0">
              <p className="text-xs font-medium text-accent-fg">{copy.phases[selectedTask.phase]}</p>
              <h3 className="mt-2 text-sm font-semibold leading-6 text-fg">{selectedTask.title}</h3>
              {selectedTask.operationalState === 'blocked' && selectedTask.blockedBy.length > 0 ? (
                <div className="mt-4 rounded-lg bg-violet-500/8 p-3">
                  <p className="text-xs font-medium text-violet-700 dark:text-violet-300">{copy.blockedBy.replace('{{count}}', String(selectedTask.blockedBy.length))}</p>
                  <ul className="mt-2 space-y-1 text-xs leading-5 text-fg-muted">
                    {selectedTask.blockedBy.map((task) => <li key={task.id}>{task.title}</li>)}
                  </ul>
                </div>
              ) : null}
              <Link to={taskDetailModalHref(returnTo, selectedTask.id)} className="mt-4 inline-flex items-center gap-1.5 text-xs font-medium text-accent-fg hover:underline">
                <ExternalLink className="size-3.5" aria-hidden />
                {copy.openTask}
              </Link>
            </aside>
          ) : null}
        </div>
      ) : <div className="flex min-h-72 items-center justify-center px-6 text-center text-sm text-fg-muted">{copy.empty}</div>}
    </section>
  );
}
