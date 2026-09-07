import { Background, Controls, Handle, Position, ReactFlow, type Node, type Edge, type NodeProps } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useMemo } from 'react';

import type { UserFocus, UserUnderstanding } from './user-context-api';

type ContextNode = Node<{ label: string; focus: boolean }>;
function ContextGraphNode({ data }: NodeProps<ContextNode>) {
  return <div className={`w-60 rounded-xl border bg-surface-panel px-3 py-3 text-sm text-fg ${data.focus ? 'border-accent' : 'border-edge'}`}>
    {!data.focus ? <Handle type="target" position={Position.Left} /> : null}
    <span className="line-clamp-2 leading-6" title={data.label}>{data.label}</span>
    {data.focus ? <Handle type="source" position={Position.Right} /> : null}
  </div>;
}
const NODE_TYPES = { context: ContextGraphNode };

export default function LocalContextGraph({ focus, understandings, onSelect }: {
  focus: UserFocus;
  understandings: UserUnderstanding[];
  onSelect: (id: string) => void;
}) {
  const nodes = useMemo<ContextNode[]>(() => [
    { id: 'focus', type: 'context', position: { x: 0, y: Math.max(0, Math.min(12, understandings.length) - 1) * 45 }, data: { label: focus.title, focus: true } },
    ...understandings.slice(0, 12).map((item, index) => ({ id: `understanding:${item.id}`, type: 'context', position: { x: 320, y: index * 90 }, data: { label: item.statement, focus: false } })),
  ], [focus, understandings]);
  const edges = useMemo<Edge[]>(() => understandings.slice(0, 12).map((item) => ({ id: item.id, source: 'focus', target: `understanding:${item.id}`, style: { stroke: 'var(--color-edge-strong)', strokeDasharray: '5 5' } })), [understandings]);
  return <div className="h-[28rem] overflow-hidden rounded-xl border border-edge"><ReactFlow nodes={nodes} edges={edges} nodeTypes={NODE_TYPES} nodesDraggable={false} nodesConnectable={false} fitView minZoom={0.4} maxZoom={1.5} onNodeClick={(_event, node) => { if (node.id !== 'focus') onSelect(node.id.slice('understanding:'.length)); }} proOptions={{ hideAttribution: true }}><Background /><Controls showInteractive={false} /></ReactFlow></div>;
}
