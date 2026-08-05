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
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Bot, GitBranch, Inbox, Layers3, Play } from 'lucide-react';
import { useMemo, useState } from 'react';

import { cn } from '@/lib/cn';
import type { StoredLanguage } from '@/lib/storage';

import type { WorkflowGraph, WorkflowGraphNode, WorkflowNodeKind } from './workflow-api';

interface DefinitionNodeData extends Record<string, unknown> {
  definitionNode: WorkflowGraphNode;
  kindLabel: string;
}

type DefinitionFlowNode = Node<DefinitionNodeData>;

export function WorkflowDefinitionGraph({
  graph,
  language,
  className,
}: {
  graph: WorkflowGraph;
  language: StoredLanguage;
  className?: string;
}) {
  const copy = definitionGraphCopy(language);
  const [selectedId, setSelectedId] = useState<string | undefined>(
    graph.nodes.find((node) => node.kind === 'agent')?.id ?? graph.nodes[0]?.id,
  );
  const nodes = useMemo<DefinitionFlowNode[]>(
    () => graph.nodes.map((node) => ({
      id: node.id,
      type: 'definitionNode',
      position: node.position,
      data: { definitionNode: node, kindLabel: copy.kind[node.kind] },
    })),
    [copy.kind, graph.nodes],
  );
  const edges = useMemo<Edge[]>(
    () => graph.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourcePort === 'true' || edge.sourcePort === 'false' ? edge.sourcePort : undefined,
      label: edge.sourcePort === 'true' ? copy.yes : edge.sourcePort === 'false' ? copy.no : undefined,
      labelStyle: { fill: 'var(--color-fg-subtle)', fontSize: 10 },
      labelBgStyle: { fill: 'var(--color-surface-panel)', fillOpacity: 0.9 },
      markerEnd: { type: MarkerType.ArrowClosed },
      style: { stroke: 'var(--color-fg-subtle)', strokeWidth: 1.5 },
    })),
    [copy.no, copy.yes, graph.edges],
  );
  const selected = graph.nodes.find((node) => node.id === selectedId);

  if (graph.nodes.length === 0) {
    return (
      <div className={cn('flex min-h-72 items-center justify-center bg-surface-base/40 px-6 text-center text-sm text-fg-muted', className)}>
        {copy.empty}
      </div>
    );
  }

  return (
    <section className={cn('overflow-hidden bg-surface-base/45', className)} aria-label={copy.ariaLabel}>
      <div className="h-[22rem] min-h-72">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={DEFINITION_NODE_TYPES}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable
          onNodeClick={(_event, node) => setSelectedId(node.id)}
          fitView
          fitViewOptions={{ padding: 0.24, minZoom: 0.45, maxZoom: 1 }}
          minZoom={0.3}
          maxZoom={1.25}
          panOnScroll
          zoomOnDoubleClick={false}
          proOptions={{ hideAttribution: true }}
        >
          <Background color="var(--color-edge)" gap={22} size={1} />
          <Controls showInteractive={false} className="!border-edge !bg-surface-panel !shadow-surface" />
        </ReactFlow>
      </div>
      <div className="flex min-h-16 items-start gap-3 border-t border-edge bg-surface-panel px-4 py-3">
        {selected ? (
          <>
            <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-fg">
              {nodeIcon(selected.kind)}
            </span>
            <span className="min-w-0">
              <strong className="block text-sm font-medium text-fg">{selected.title}</strong>
              <span className="mt-0.5 block text-xs leading-5 text-fg-muted">
                {selected.description || copy.kind[selected.kind]}
              </span>
            </span>
          </>
        ) : (
          <span className="text-xs text-fg-muted">{copy.selectHint}</span>
        )}
      </div>
    </section>
  );
}

function DefinitionNodeCard({ data, selected }: NodeProps<DefinitionFlowNode>) {
  const node = data.definitionNode;
  return (
    <div
      className={cn(
        'w-48 rounded-xl border bg-surface-panel p-3 shadow-surface transition-colors',
        selected ? 'border-accent ring-2 ring-accent/20' : 'border-edge',
      )}
    >
      {node.kind !== 'input' ? <Handle type="target" position={Position.Left} className="!invisible" /> : null}
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-fg">
          {nodeIcon(node.kind)}
        </span>
        <span className="min-w-0">
          <strong className="block truncate text-sm font-medium text-fg">{node.title}</strong>
          <span className="mt-1 block text-xs text-fg-subtle">{data.kindLabel}</span>
        </span>
      </div>
      {node.kind === 'decision' ? (
        <>
          <Handle id="true" type="source" position={Position.Right} style={{ top: '38%' }} className="!invisible" />
          <Handle id="false" type="source" position={Position.Right} style={{ top: '70%' }} className="!invisible" />
        </>
      ) : node.kind !== 'output' ? (
        <Handle type="source" position={Position.Right} className="!invisible" />
      ) : null}
    </div>
  );
}

function nodeIcon(kind: WorkflowNodeKind) {
  if (kind === 'input') return <Inbox className="size-4" aria-hidden />;
  if (kind === 'agent') return <Bot className="size-4" aria-hidden />;
  if (kind === 'decision') return <GitBranch className="size-4" aria-hidden />;
  if (kind === 'merge') return <Layers3 className="size-4" aria-hidden />;
  return <Play className="size-4" aria-hidden />;
}

const DEFINITION_NODE_TYPES = { definitionNode: DefinitionNodeCard };

function definitionGraphCopy(language: StoredLanguage) {
  return language === 'zh'
    ? {
        ariaLabel: '工作流步骤图',
        empty: '这个工作流还没有可展示的步骤。',
        selectHint: '点击步骤查看它的作用。',
        yes: '是',
        no: '否',
        kind: { input: '任务输入', agent: 'AI 执行', decision: '条件判断', merge: '汇总结果', output: '最终结果' } satisfies Record<WorkflowNodeKind, string>,
      }
    : {
        ariaLabel: 'Workflow step map',
        empty: 'This workflow has no steps to display yet.',
        selectHint: 'Select a step to see what it does.',
        yes: 'Yes',
        no: 'No',
        kind: { input: 'Task input', agent: 'AI work', decision: 'Decision', merge: 'Combine results', output: 'Deliverable' } satisfies Record<WorkflowNodeKind, string>,
      };
}
