import { Background, Handle, MarkerType, Position, ReactFlow, type Edge, type Node, type NodeProps, type ReactFlowInstance } from '@xyflow/react';
import { AlertTriangle, Bot, Check, GitBranch, Inbox, Layers3, Play, RotateCcw } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import type { StoredLanguage } from '@/lib/storage';

import type { WorkflowGraph, WorkflowGraphNode, WorkflowNodeView, WorkflowRunView } from './workflow-api';

interface RunNodeData extends Record<string, unknown> {
  definitionNode: WorkflowGraphNode;
  runNode?: WorkflowNodeView;
}

type RunFlowNode = Node<RunNodeData>;

export function WorkflowRunGraph({ graph, view, language, onRepair }: { graph: WorkflowGraph; view: WorkflowRunView; language: StoredLanguage; onRepair?: () => void }) {
  const [selectedId, setSelectedId] = useState<string>();
  const flowRef = useRef<ReactFlowInstance<RunFlowNode, Edge> | null>(null);
  const lastAutoFocusedIdRef = useRef<string | undefined>(undefined);
  const copy = runGraphCopy(language);
  const statuses = useMemo(() => new Map(view.nodes.map((node) => [node.id, node])), [view.nodes]);
  const nodes = useMemo<RunFlowNode[]>(() => graph.nodes.map((node) => ({
    id: node.id,
    type: 'runNode',
    position: node.position,
    data: { definitionNode: node, runNode: statuses.get(node.id) },
  })), [graph.nodes, statuses]);
  const edges = useMemo<Edge[]>(() => graph.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourcePort === 'true' || edge.sourcePort === 'false' ? edge.sourcePort : undefined,
    markerEnd: { type: MarkerType.ArrowClosed },
    animated: statuses.get(edge.source)?.status === 'running',
    style: { stroke: statuses.get(edge.source)?.status === 'done' ? 'var(--color-success)' : 'var(--color-fg-subtle)', strokeWidth: 1.5 },
  })), [graph.edges, statuses]);
  const selected = selectedId ? statuses.get(selectedId) : undefined;
  const selectedDefinition = selectedId ? graph.nodes.find((node) => node.id === selectedId) : undefined;
  const hasFailure = view.nodes.some((node) => node.status === 'error');

  useEffect(() => {
    const focusNode = view.nodes.find((node) => node.status === 'running')
      ?? view.nodes.find((node) => node.status === 'error')
      ?? [...view.nodes].reverse().find((node) => node.status === 'done');
    if (!focusNode || lastAutoFocusedIdRef.current === focusNode.id) return;
    lastAutoFocusedIdRef.current = focusNode.id;
    setSelectedId(focusNode.id);
    const frame = window.requestAnimationFrame(() => {
      void flowRef.current?.fitView({ nodes: [{ id: focusNode.id }], padding: 1.4, minZoom: 0.65, maxZoom: 1, duration: 300 });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [view.nodes]);

  return (
    <section className="mt-5 overflow-hidden rounded-2xl border border-edge bg-surface-base/35">
      <div className="flex items-center justify-between gap-3 border-b border-edge px-4 py-3">
        <div><h3 className="text-sm font-semibold text-fg">{copy.title}</h3><p className="mt-0.5 text-xs text-fg-subtle">{copy.hint}</p></div>
        {hasFailure && onRepair ? <Button variant="secondary" className="h-8 text-xs" onClick={onRepair}><RotateCcw className="size-3.5" />{copy.repair}</Button> : null}
      </div>
      <div className="h-[28rem]">
        <ReactFlow nodes={nodes} edges={edges} nodeTypes={RUN_NODE_TYPES} nodesDraggable={false} nodesConnectable={false} elementsSelectable onNodeClick={(_event, node) => setSelectedId(node.id)} onInit={(instance) => { flowRef.current = instance; }} fitView minZoom={0.3} maxZoom={1.25} panOnScroll zoomOnDoubleClick={false} proOptions={{ hideAttribution: true }}>
          <Background color="var(--color-edge)" gap={22} size={1} />
        </ReactFlow>
      </div>
      {selected ? (
        <div className={cn('flex items-start gap-2 border-t border-edge px-4 py-3 text-xs', selected.status === 'error' ? 'text-danger' : 'text-fg-muted')}>
          {selected.status === 'error' ? <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> : selected.status === 'done' ? <Check className="mt-0.5 size-3.5 shrink-0 text-success" /> : null}
          <span>
            <strong className="font-medium text-fg">{selected.title}</strong>
            {selectedDefinition?.description ? <span className="block pt-0.5 text-fg-subtle">{selectedDefinition.description}</span> : null}
            <span className="block pt-1">{selected.error || selected.resultPreview || copy.status[selected.status]}</span>
          </span>
        </div>
      ) : null}
    </section>
  );
}

function RunNodeCard({ data, selected }: NodeProps<RunFlowNode>) {
  const node = data.definitionNode;
  const status = data.runNode?.status ?? 'pending';
  const icon = node.kind === 'input' ? <Inbox /> : node.kind === 'agent' ? <Bot /> : node.kind === 'decision' ? <GitBranch /> : node.kind === 'merge' ? <Layers3 /> : <Play />;
  return (
    <div className={cn(
      'w-48 rounded-xl border bg-surface-panel px-3 py-2.5 shadow-surface',
      status === 'running' && 'border-accent ring-2 ring-accent/20',
      status === 'done' && 'border-success/50',
      status === 'error' && 'border-danger ring-2 ring-danger/15',
      (status === 'pending' || status === 'skipped') && 'border-edge opacity-70',
      selected && 'ring-2 ring-accent/25',
    )}>
      {node.kind !== 'input' ? <Handle type="target" position={Position.Left} className="!invisible" /> : null}
      <div className="flex items-center gap-2">
        <span className="[&>svg]:size-4 text-fg-subtle">{icon}</span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg">{node.title}</span>
        <StatusMark status={status} />
      </div>
      {node.description ? <p className="mt-1.5 line-clamp-2 text-xs leading-4 text-fg-muted">{node.description}</p> : null}
      {node.kind === 'decision' ? <><Handle id="true" type="source" position={Position.Right} className="!invisible" /><Handle id="false" type="source" position={Position.Right} className="!invisible" /></> : node.kind !== 'output' ? <Handle type="source" position={Position.Right} className="!invisible" /> : null}
    </div>
  );
}

function StatusMark({ status }: { status: WorkflowNodeView['status'] }) {
  if (status === 'done') return <span className="flex size-5 items-center justify-center rounded-full bg-success-soft text-success"><Check className="size-3" /></span>;
  if (status === 'error') return <span className="flex size-5 items-center justify-center rounded-full bg-danger/10 text-danger"><AlertTriangle className="size-3" /></span>;
  if (status === 'running') return <span className="size-2.5 animate-pulse rounded-full bg-accent motion-reduce:animate-none" />;
  return <span className="size-2 rounded-full bg-edge-strong" />;
}

const RUN_NODE_TYPES = { runNode: RunNodeCard };

function runGraphCopy(language: StoredLanguage) {
  return language === 'zh' ? { title: '运行过程', hint: '点选步骤查看当前结果；画布会随着执行自动更新。', repair: '修复这个工作流', status: { pending: '等待中', running: '执行中', done: '已完成', error: '失败', skipped: '已跳过' } } : { title: 'Live workflow', hint: 'Select a step to inspect it. The canvas updates as work progresses.', repair: 'Repair workflow', status: { pending: 'Waiting', running: 'Running', done: 'Completed', error: 'Failed', skipped: 'Skipped' } };
}
