import * as Dialog from '@radix-ui/react-dialog';
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  addEdge,
  applyEdgeChanges,
  useNodesState,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Bot, GitBranch, History, Inbox, Layers3, Play, RotateCcw, Save, Sparkles, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { PopoverSelect } from '@/components/ui/popover-select';
import { cn } from '@/lib/cn';
import type { StoredLanguage } from '@/lib/storage';

import {
  createWorkflowDraft,
  deleteWorkflowAuthoringDraft,
  listWorkflowRevisions,
  restoreWorkflowRevision,
  saveWorkflowAuthoringDraft,
  validateWorkflowDefinition,
  type ValidateWorkflowDefinitionResponse,
  type WorkflowDefinition,
  type WorkflowDefinitionManifest,
  type WorkflowGraph,
  type WorkflowGraphNode,
  type WorkflowNodeKind,
  type WorkflowRevisionSummary,
} from './workflow-api';

export interface WorkflowEditorInitialDraft {
  mode: 'edit' | 'copy';
  name: string;
  graph: WorkflowGraph;
  manifest: WorkflowDefinitionManifest;
  baseRevision: number;
  sourceTitle: string;
  repairPrompt?: string;
}

interface SavePayload {
  name: string;
  graph: WorkflowGraph;
  manifest: WorkflowDefinitionManifest;
  expectedRevision: number;
}

interface FlowNodeData extends Record<string, unknown> {
  workflowNode: WorkflowGraphNode;
}

type StudioNode = Node<FlowNodeData>;

const FLOW_FIT_VIEW_OPTIONS = { padding: 0.24, minZoom: 0.45, maxZoom: 1 } as const;

export function WorkflowCreateDialog({
  open,
  language,
  ownerAgentId,
  saving,
  initialDraft,
  onClose,
  onSave,
  onSaveAndStart,
}: {
  open: boolean;
  language: StoredLanguage;
  ownerAgentId?: string;
  saving: boolean;
  initialDraft?: WorkflowEditorInitialDraft | null;
  onClose: () => void;
  onSave: (payload: SavePayload) => Promise<WorkflowDefinition | void> | WorkflowDefinition | void;
  onSaveAndStart: (payload: SavePayload & { goal: string }) => Promise<void> | void;
}) {
  const copy = studioCopy(language);
  const [name, setName] = useState('my_workflow');
  const [graph, setGraph] = useState<WorkflowGraph>(() => createStarterGraph());
  const [manifest, setManifest] = useState<WorkflowDefinitionManifest>(() => ({ title: copy.untitled, description: '', tags: ['custom'] }));
  const [selectedNodeId, setSelectedNodeId] = useState<string>('agent-1');
  const [flowNodes, setFlowNodes, onFlowNodesChange] = useNodesState<StudioNode>(
    graph.nodes.map((node) => toFlowNode(node, node.id === 'agent-1')),
  );
  const [aiPrompt, setAiPrompt] = useState('');
  const [testGoal, setTestGoal] = useState('');
  const [generating, setGenerating] = useState(false);
  const [validation, setValidation] = useState<ValidateWorkflowDefinitionResponse | null>(null);
  const [draftStatus, setDraftStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [currentRevision, setCurrentRevision] = useState(0);
  const [revisions, setRevisions] = useState<WorkflowRevisionSummary[]>([]);
  const [restoringRevision, setRestoringRevision] = useState<number | null>(null);
  const initializedKey = useRef('');
  const draftIdRef = useRef<string | undefined>(undefined);
  const draftUpdatedAtMsRef = useRef<number | undefined>(undefined);
  const flowInstanceRef = useRef<ReactFlowInstance<StudioNode, Edge> | null>(null);
  const [fitViewRevision, setFitViewRevision] = useState(0);

  useEffect(() => {
    if (!open) {
      initializedKey.current = '';
      flowInstanceRef.current = null;
      return;
    }
    const key = `${initialDraft?.mode ?? 'new'}:${initialDraft?.name ?? ''}:${initialDraft?.baseRevision ?? 0}`;
    if (initializedKey.current === key) return;
    initializedKey.current = key;
    setName(initialDraft?.name ?? 'my_workflow');
    setGraph(structuredClone(initialDraft?.graph ?? createStarterGraph()));
    setFitViewRevision((revision) => revision + 1);
    setManifest(structuredClone(initialDraft?.manifest ?? { title: copy.untitled, description: '', tags: ['custom'] }));
    setSelectedNodeId(initialDraft?.graph.nodes.find((node) => node.kind === 'agent')?.id ?? 'agent-1');
    setAiPrompt(initialDraft?.repairPrompt ?? '');
    setTestGoal('');
    setValidation(null);
    setCurrentRevision(initialDraft?.baseRevision ?? 0);
    setRevisions([]);
    setRestoringRevision(null);
    draftIdRef.current = undefined;
    draftUpdatedAtMsRef.current = undefined;
    setDraftStatus('idle');
  }, [copy.untitled, initialDraft, open]);

  useEffect(() => {
    if (!open || initialDraft?.mode !== 'edit') return;
    void listWorkflowRevisions(initialDraft.name).then(setRevisions).catch(() => setRevisions([]));
  }, [initialDraft?.mode, initialDraft?.name, open]);

  useEffect(() => {
    if (!open || !name.trim()) return;
    const timer = window.setTimeout(() => {
      void validateWorkflowDefinition(name, graph).then(setValidation).catch(() => setValidation(null));
    }, 350);
    return () => window.clearTimeout(timer);
  }, [graph, name, open]);

  useEffect(() => {
    if (!open || !name.trim()) return;
    setDraftStatus('saving');
    const timer = window.setTimeout(() => {
      void saveWorkflowAuthoringDraft({
        id: draftIdRef.current,
        workflowName: name,
        graph,
        manifest,
        baseRevision: currentRevision,
        expectedUpdatedAtMs: draftUpdatedAtMsRef.current,
      }).then((draft) => {
        draftIdRef.current = draft.id;
        draftUpdatedAtMsRef.current = draft.updatedAtMs;
        setDraftStatus('saved');
      }).catch(() => setDraftStatus('error'));
    }, 900);
    return () => window.clearTimeout(timer);
  }, [currentRevision, graph, manifest, name, open]);

  useLayoutEffect(() => {
    setFlowNodes((current) => {
      const currentById = new Map(current.map((node) => [node.id, node]));
      return graph.nodes.map((node) => ({
        ...currentById.get(node.id),
        ...toFlowNode(node, node.id === selectedNodeId),
      }));
    });
  }, [graph.nodes, selectedNodeId, setFlowNodes]);

  useEffect(() => {
    const instance = flowInstanceRef.current;
    if (!open || !instance || graph.nodes.length === 0) return;
    const frame = window.requestAnimationFrame(() => {
      void instance.fitView(FLOW_FIT_VIEW_OPTIONS);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [fitViewRevision, graph.nodes.length, open]);

  const flowEdges = useMemo(() => graph.edges.map(toFlowEdge), [graph.edges]);
  const selectedNode = graph.nodes.find((node) => node.id === selectedNodeId) ?? null;
  const canPublish = validation?.valid === true && !saving && !generating;

  const commitNodePosition = useCallback((draggedNode: StudioNode) => {
    setGraph((current) => {
      const nodes = current.nodes.map((node) => {
        if (node.id !== draggedNode.id) return node;
        if (node.position.x === draggedNode.position.x && node.position.y === draggedNode.position.y) return node;
        return { ...node, position: draggedNode.position };
      });
      return nodes.some((node, index) => node !== current.nodes[index]) ? { ...current, nodes } : current;
    });
  }, []);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    const structuralChanges = changes.filter((change) => change.type !== 'select');
    if (structuralChanges.length === 0) return;
    setGraph((current) => ({
      ...current,
      edges: applyEdgeChanges(structuralChanges, current.edges.map(toFlowEdge)).map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        sourcePort: edge.sourceHandle === 'true' || edge.sourceHandle === 'false' ? edge.sourceHandle : undefined,
      })),
    }));
  }, []);

  const onConnect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target) return;
    setGraph((current) => ({
      ...current,
      edges: addEdge({ ...connection, id: `edge-${crypto.randomUUID()}` }, current.edges.map(toFlowEdge)).map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        sourcePort: edge.sourceHandle === 'true' || edge.sourceHandle === 'false' ? edge.sourceHandle : undefined,
      })),
    }));
  }, []);

  const updateNode = useCallback((id: string, update: (node: WorkflowGraphNode) => WorkflowGraphNode) => {
    setGraph((current) => ({ ...current, nodes: current.nodes.map((node) => node.id === id ? update(node) : node) }));
  }, []);

  const addNode = (kind: Extract<WorkflowNodeKind, 'agent' | 'decision' | 'merge'>) => {
    const id = `${kind}-${crypto.randomUUID().slice(0, 8)}`;
    const node = createNode(kind, id, graph.nodes.length);
    setGraph((current) => {
      const source = current.nodes.find((item) => item.id === selectedNodeId && item.kind !== 'output');
      const edge = source ? [{ id: `edge-${crypto.randomUUID()}`, source: source.id, target: id }] : [];
      return { ...current, nodes: [...current.nodes, node], edges: [...current.edges, ...edge] };
    });
    setFitViewRevision((revision) => revision + 1);
    setSelectedNodeId(id);
  };

  const removeSelectedNode = () => {
    if (!selectedNode || selectedNode.kind === 'input' || selectedNode.kind === 'output') return;
    setGraph((current) => ({
      ...current,
      nodes: current.nodes.filter((node) => node.id !== selectedNode.id),
      edges: current.edges.filter((edge) => edge.source !== selectedNode.id && edge.target !== selectedNode.id),
    }));
    setFitViewRevision((revision) => revision + 1);
    setSelectedNodeId('');
  };

  const generate = async () => {
    if (!aiPrompt.trim()) return;
    setGenerating(true);
    try {
      const draft = await createWorkflowDraft({
        prompt: aiPrompt,
        agentId: ownerAgentId,
        language: language === 'zh' ? 'zh' : 'en',
        mode: initialDraft || graph.nodes.length > 3 ? 'improve' : 'create',
        existingGraph: graph,
      });
      setName(draft.name);
      setGraph(draft.graph);
      setFitViewRevision((revision) => revision + 1);
      setManifest(draft.manifest);
      setSelectedNodeId(draft.graph.nodes.find((node) => node.kind === 'agent')?.id ?? '');
      setValidation(draft.validation);
      setAiPrompt('');
    } finally {
      setGenerating(false);
    }
  };

  const publish = async (start: boolean) => {
    if (!canPublish) return;
    const payload = { name, graph, manifest, expectedRevision: currentRevision };
    try {
      if (start) {
        await onSaveAndStart({ ...payload, goal: testGoal.trim() || manifest.description || name });
      } else {
        const saved = await onSave(payload);
        if (!saved) return;
        setCurrentRevision(saved.revision);
      }
      if (draftIdRef.current) await deleteWorkflowAuthoringDraft(draftIdRef.current).catch(() => undefined);
    } catch {
      return;
    }
  };

  const restoreRevision = async (revision: number) => {
    if (restoringRevision !== null || initialDraft?.mode !== 'edit') return;
    setRestoringRevision(revision);
    try {
      const restored = await restoreWorkflowRevision(initialDraft.name, revision, currentRevision);
      setGraph(restored.graph);
      setFitViewRevision((fitRevision) => fitRevision + 1);
      setManifest(definitionToManifest(restored));
      setCurrentRevision(restored.revision);
      setSelectedNodeId(restored.graph.nodes.find((node) => node.kind === 'agent')?.id ?? '');
      setRevisions(await listWorkflowRevisions(initialDraft.name));
    } finally {
      setRestoringRevision(null);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="xopc-dialog-overlay fixed inset-0 z-65 bg-scrim backdrop-blur-[1px]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-66 flex h-[min(94vh,58rem)] w-[min(100%-1.5rem,88rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-edge bg-surface-panel shadow-popover outline-none">
          <header className="flex shrink-0 items-center gap-3 border-b border-edge px-4 py-3">
            <div className="min-w-0 flex-1">
              <Dialog.Title className="text-base font-semibold text-fg">{initialDraft?.mode === 'edit' ? copy.editTitle : copy.createTitle}</Dialog.Title>
              <Dialog.Description className="mt-0.5 text-xs text-fg-muted">{copy.subtitle}</Dialog.Description>
            </div>
            <span className={cn('text-xs', draftStatus === 'error' ? 'text-danger' : 'text-fg-subtle')}>
              {draftStatus === 'saving' ? copy.savingDraft : draftStatus === 'saved' ? copy.savedDraft : draftStatus === 'error' ? copy.draftError : ''}
            </span>
            <Dialog.Close asChild><Button variant="ghost" className="size-9 p-0" aria-label={copy.close}><X className="size-4" /></Button></Dialog.Close>
          </header>

          <div className="flex min-h-0 flex-1">
            <section className="flex min-w-0 flex-1 flex-col bg-surface-base">
              <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-edge px-3 py-2">
                <div className="mr-2 min-w-36">
                  <h2 className="text-sm font-semibold text-fg">{copy.flowTitle}</h2>
                  <p className="text-xs text-fg-subtle">{copy.stepCount(graph.nodes.length)}</p>
                </div>
                <Button variant="secondary" className="h-8 rounded-lg text-xs" onClick={() => addNode('agent')}><Bot className="size-3.5" />{copy.addAgent}</Button>
                <Button variant="secondary" className="h-8 rounded-lg text-xs" onClick={() => addNode('decision')}><GitBranch className="size-3.5" />{copy.addDecision}</Button>
                <Button variant="secondary" className="h-8 rounded-lg text-xs" onClick={() => addNode('merge')}><Layers3 className="size-3.5" />{copy.addMerge}</Button>
                <span className="ml-auto text-xs text-fg-subtle">{copy.canvasHint}</span>
              </div>
              <div className="relative min-h-72 flex-1">
                {graph.nodes.length > 0 ? <ReactFlow
                  aria-label={copy.flowAria}
                  nodes={flowNodes}
                  edges={flowEdges}
                  nodeTypes={NODE_TYPES}
                  onNodesChange={onFlowNodesChange}
                  onEdgesChange={onEdgesChange}
                  onConnect={onConnect}
                  onNodeClick={(_event, node) => setSelectedNodeId(node.id)}
                  onNodeDragStart={(_event, node) => setSelectedNodeId(node.id)}
                  onNodeDragStop={(_event, node) => commitNodePosition(node)}
                  onInit={(instance) => {
                    flowInstanceRef.current = instance;
                    window.requestAnimationFrame(() => {
                      void instance.fitView(FLOW_FIT_VIEW_OPTIONS);
                    });
                  }}
                  fitView
                  fitViewOptions={FLOW_FIT_VIEW_OPTIONS}
                  minZoom={0.25}
                  maxZoom={1.5}
                  deleteKeyCode={null}
                  proOptions={{ hideAttribution: true }}
                >
                  <Background color="var(--color-edge)" gap={22} size={1} />
                  <Controls showInteractive={false} className="!border-edge !bg-surface-panel !shadow-surface" />
                </ReactFlow> : (
                  <div className="flex h-full items-center justify-center px-6 text-center text-sm text-fg-muted">{copy.emptyFlow}</div>
                )}
              </div>
            </section>

            <aside className="flex w-[22rem] shrink-0 flex-col border-l border-edge bg-surface-panel">
              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                <section>
                  <label className="block text-xs font-medium text-fg" htmlFor="workflow-name">{copy.workflowName}</label>
                  <input id="workflow-name" value={name} onChange={(event) => setName(normalizeName(event.target.value))} className={fieldClass} />
                  <label className="mt-3 block text-xs font-medium text-fg" htmlFor="workflow-title">{copy.humanTitle}</label>
                  <input id="workflow-title" value={manifest.title ?? ''} onChange={(event) => setManifest((current) => ({ ...current, title: event.target.value }))} className={fieldClass} />
                  <label className="mt-3 block text-xs font-medium text-fg" htmlFor="workflow-description">{copy.outcome}</label>
                  <textarea id="workflow-description" value={manifest.description ?? ''} onChange={(event) => setManifest((current) => ({ ...current, description: event.target.value }))} className={`${fieldClass} min-h-20 resize-y`} />
                  {initialDraft?.mode === 'edit' && revisions.length > 0 ? (
                    <details className="mt-4 border-t border-edge pt-3">
                      <summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-medium text-fg-muted">
                        <History className="size-3.5" />{copy.versions} · v{currentRevision}
                      </summary>
                      <div className="mt-2 space-y-1">
                        {revisions.map((item) => (
                          <div key={item.revision} className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 hover:bg-surface-hover">
                            <span className="min-w-0 text-xs text-fg-muted">v{item.revision} · {new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' }).format(item.createdAtMs)}</span>
                            {item.revision === currentRevision ? <span className="text-xs text-fg-subtle">{copy.currentVersion}</span> : (
                              <Button variant="ghost" className="h-7 shrink-0 px-2 text-xs" disabled={restoringRevision !== null} onClick={() => void restoreRevision(item.revision)}>
                                <RotateCcw className="size-3" />{restoringRevision === item.revision ? copy.restoring : copy.restore}
                              </Button>
                            )}
                          </div>
                        ))}
                      </div>
                    </details>
                  ) : null}
                </section>

                <div className="my-4 border-t border-edge" />
                {selectedNode ? (
                  <NodeInspector node={selectedNode} copy={copy} updateNode={updateNode} onDelete={removeSelectedNode} />
                ) : (
                  <div className="py-8 text-center text-sm text-fg-muted">{copy.selectNode}</div>
                )}

                {validation && !validation.valid ? (
                  <section className="mt-4 rounded-lg border border-danger/30 bg-danger/5 p-3">
                    <h3 className="text-xs font-medium text-danger">{copy.needsAttention}</h3>
                    <ul className="mt-2 space-y-1 text-xs text-danger">
                      {validation.errors.slice(0, 5).map((issue, index) => <li key={`${issue.code}-${index}`}>• {issue.message}</li>)}
                    </ul>
                  </section>
                ) : null}
              </div>
            </aside>
          </div>

          <footer className="shrink-0 border-t border-edge bg-surface-panel p-3">
            <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <Sparkles className="size-4 shrink-0 text-accent-fg" />
                <input value={aiPrompt} onChange={(event) => setAiPrompt(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void generate(); }} placeholder={copy.aiPlaceholder} className={`${fieldClass} mt-0 flex-1`} />
                <Button variant="secondary" className="h-10 shrink-0" disabled={generating || !aiPrompt.trim()} onClick={() => void generate()}>{generating ? copy.designing : copy.applyWithAi}</Button>
              </div>
              <div className="flex items-center gap-2">
                <input value={testGoal} onChange={(event) => setTestGoal(event.target.value)} placeholder={copy.testGoal} className={`${fieldClass} mt-0 w-52`} />
                <Button variant="secondary" disabled={!canPublish} onClick={() => void publish(false)}><Save className="size-4" />{copy.publish}</Button>
                <Button variant="primary" disabled={!canPublish} onClick={() => void publish(true)}><Play className="size-4" />{copy.publishAndRun}</Button>
              </div>
            </div>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function WorkflowNodeCard({ data, selected }: NodeProps<StudioNode>) {
  const node = data.workflowNode;
  const icon = node.kind === 'input' ? <Inbox /> : node.kind === 'agent' ? <Bot /> : node.kind === 'decision' ? <GitBranch /> : node.kind === 'merge' ? <Layers3 /> : <Play />;
  return (
    <div className={cn('w-52 rounded-xl border bg-surface-panel px-3 py-3 shadow-surface transition-colors', selected ? 'border-accent ring-2 ring-accent/20' : 'border-edge')}>
      {node.kind !== 'input' ? <Handle type="target" position={Position.Left} className="!size-2.5 !border-2 !border-surface-panel !bg-fg-subtle" /> : null}
      <div className="flex items-start gap-2">
        <span className="mt-0.5 [&>svg]:size-4 text-accent-fg">{icon}</span>
        <span className="min-w-0"><strong className="block truncate text-sm font-medium text-fg">{node.title}</strong><span className="mt-1 block line-clamp-2 text-xs leading-4 text-fg-muted">{node.description || nodeKindLabel(node.kind)}</span></span>
      </div>
      {node.kind === 'decision' ? (
        <><Handle id="true" type="source" position={Position.Right} style={{ top: '38%' }} className="!size-2.5 !border-2 !border-surface-panel !bg-success" /><Handle id="false" type="source" position={Position.Right} style={{ top: '70%' }} className="!size-2.5 !border-2 !border-surface-panel !bg-danger" /></>
      ) : node.kind !== 'output' ? <Handle type="source" position={Position.Right} className="!size-2.5 !border-2 !border-surface-panel !bg-accent" /> : null}
    </div>
  );
}

const NODE_TYPES = { workflow: WorkflowNodeCard };

function NodeInspector({ node, copy, updateNode, onDelete }: { node: WorkflowGraphNode; copy: ReturnType<typeof studioCopy>; updateNode: (id: string, update: (node: WorkflowGraphNode) => WorkflowGraphNode) => void; onDelete: () => void }) {
  const update = (patch: Partial<WorkflowGraphNode>) => updateNode(node.id, (current) => ({ ...current, ...patch }));
  const updateConfig = (patch: Record<string, unknown>) => updateNode(node.id, (current) => ({ ...current, config: { ...current.config, ...patch } }));
  return (
    <section>
      <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-semibold text-fg">{copy.stepSettings}</h3>{node.kind !== 'input' && node.kind !== 'output' ? <Button variant="ghost" className="h-8 px-2 text-danger" onClick={onDelete}><Trash2 className="size-3.5" />{copy.remove}</Button> : null}</div>
      <label className="mt-3 block text-xs font-medium text-fg" htmlFor="node-title">{copy.stepName}</label>
      <input id="node-title" value={node.title} onChange={(event) => update({ title: event.target.value })} className={fieldClass} />
      <label className="mt-3 block text-xs font-medium text-fg" htmlFor="node-description">{copy.stepPurpose}</label>
      <textarea id="node-description" value={node.description ?? ''} onChange={(event) => update({ description: event.target.value })} className={`${fieldClass} min-h-16 resize-y`} />
      {node.kind === 'agent' ? <>
        <label className="mt-3 block text-xs font-medium text-fg" htmlFor="node-prompt">{copy.instructions}</label>
        <textarea id="node-prompt" value={String(node.config.prompt ?? '')} onChange={(event) => updateConfig({ prompt: event.target.value })} className={`${fieldClass} min-h-36 resize-y`} />
        <details className="mt-4 border-t border-edge pt-3">
          <summary className="cursor-pointer text-xs font-medium text-fg-muted">{copy.advanced}</summary>
          <label className="mt-3 block text-xs font-medium text-fg" htmlFor="node-model">{copy.model}</label>
          <input id="node-model" value={String(node.config.model ?? '')} onChange={(event) => updateConfig({ model: event.target.value || undefined })} placeholder={copy.defaultModel} className={fieldClass} />
        </details>
      </> : null}
      {node.kind === 'decision' ? <>
        <label className="mt-3 block text-xs font-medium text-fg" htmlFor="decision-path">{copy.valuePath}</label>
        <input id="decision-path" value={node.config.rule?.path ?? ''} onChange={(event) => updateConfig({ rule: { ...(node.config.rule ?? { operator: 'exists' }), path: event.target.value } })} placeholder="result.approved" className={fieldClass} />
        <label className="mt-3 block text-xs font-medium text-fg" id="decision-operator-label">{copy.condition}</label>
        <PopoverSelect value={node.config.rule?.operator ?? 'exists'} placeholder={copy.condition} allowEmpty={false} ariaLabelledBy="decision-operator-label" options={[{ value: 'exists', label: copy.exists }, { value: 'equals', label: copy.equals }, { value: 'not_equals', label: copy.notEquals }, { value: 'contains', label: copy.contains }]} onChange={(operator) => updateConfig({ rule: { ...(node.config.rule ?? { path: '' }), operator } })} />
        {node.config.rule?.operator !== 'exists' ? <><label className="mt-3 block text-xs font-medium text-fg" htmlFor="decision-value">{copy.compareValue}</label><input id="decision-value" value={String(node.config.rule?.value ?? '')} onChange={(event) => updateConfig({ rule: { ...node.config.rule!, value: event.target.value } })} className={fieldClass} /></> : null}
      </> : null}
      {node.kind === 'merge' ? <><label className="mt-3 block text-xs font-medium text-fg" id="merge-mode-label">{copy.combineAs}</label><PopoverSelect value={String(node.config.mode ?? 'object')} placeholder={copy.combineAs} allowEmpty={false} ariaLabelledBy="merge-mode-label" options={[{ value: 'object', label: copy.namedResults }, { value: 'array', label: copy.listResults }]} onChange={(mode) => updateConfig({ mode })} /></> : null}
      {node.kind === 'output' ? <><label className="mt-3 block text-xs font-medium text-fg" htmlFor="output-summary">{copy.summaryTemplate}</label><textarea id="output-summary" value={String(node.config.summary ?? '')} onChange={(event) => updateConfig({ summary: event.target.value || undefined })} placeholder={copy.autoSummary} className={`${fieldClass} min-h-20 resize-y`} /></> : null}
    </section>
  );
}

const fieldClass = 'mt-1 block h-10 w-full rounded-lg border border-edge bg-surface-subtle px-3 text-sm text-fg outline-none placeholder:text-fg-subtle focus:border-edge-strong';

function toFlowNode(node: WorkflowGraphNode, selected = false): StudioNode { return { id: node.id, type: 'workflow', position: node.position, selected, data: { workflowNode: node } }; }
function toFlowEdge(edge: WorkflowGraph['edges'][number]): Edge { return { id: edge.id, source: edge.source, target: edge.target, sourceHandle: edge.sourcePort === 'true' || edge.sourcePort === 'false' ? edge.sourcePort : undefined, markerEnd: { type: MarkerType.ArrowClosed }, style: { stroke: 'var(--color-fg-subtle)', strokeWidth: 1.5 } }; }

function createStarterGraph(): WorkflowGraph {
  return { schemaVersion: 1, nodes: [
    { id: 'input', kind: 'input', title: 'Input', description: 'What the user provides', position: { x: 0, y: 120 }, config: {} },
    { id: 'agent-1', kind: 'agent', title: 'Do the work', description: 'Understand and complete the request', phaseId: 'work', position: { x: 300, y: 120 }, config: { prompt: 'Complete this goal: {{goal}}\n\nUser input:\n{{input}}', maxIterations: 12 } },
    { id: 'output', kind: 'output', title: 'Result', description: 'A clear answer for the user', position: { x: 620, y: 120 }, config: {} },
  ], edges: [{ id: 'input-agent', source: 'input', target: 'agent-1' }, { id: 'agent-output', source: 'agent-1', target: 'output' }] };
}

function createNode(kind: 'agent' | 'decision' | 'merge', id: string, index: number): WorkflowGraphNode {
  const position = { x: 280 + (index % 3) * 280, y: 80 + Math.floor(index / 3) * 180 };
  if (kind === 'agent') return { id, kind, title: 'New AI step', description: 'Describe what this step should accomplish', phaseId: 'work', position, config: { prompt: 'Use the previous results to complete this step:\n{{predecessors}}', maxIterations: 12 } };
  if (kind === 'decision') return { id, kind, title: 'Check a condition', description: 'Choose what happens next', position, config: { rule: { path: '', operator: 'exists' } } };
  return { id, kind, title: 'Combine results', description: 'Bring parallel work together', position, config: { mode: 'object' } };
}

function normalizeName(value: string): string { return value.toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+/, ''); }
function nodeKindLabel(kind: WorkflowNodeKind): string { return ({ input: 'User input', agent: 'AI step', decision: 'Decision', merge: 'Combine', output: 'User result' })[kind]; }

function definitionToManifest(definition: WorkflowDefinition): WorkflowDefinitionManifest {
  return {
    title: definition.title,
    description: definition.description,
    version: definition.version,
    inputSchema: definition.inputSchema,
    outputSchema: definition.outputSchema,
    defaults: definition.defaults,
    tags: definition.metadata.tags,
    whenToUse: definition.metadata.whenToUse,
    estimatedAgents: definition.metadata.estimatedAgents,
    permissions: definition.permissions,
    resources: definition.resources,
  };
}

function studioCopy(language: StoredLanguage) {
  const zh = language === 'zh';
  return zh ? {
    untitled: '未命名工作流', editTitle: '编辑工作流', createTitle: '创建工作流', subtitle: '描述目标、连接步骤，然后直接运行。无需编写代码。', close: '关闭', savingDraft: '正在保存草稿…', savedDraft: '草稿已保存', draftError: '草稿保存失败', flowTitle: '工作流步骤图', flowAria: '可编辑的工作流步骤图', stepCount: (count: number) => `${count} 个步骤 · 点击步骤可编辑`, emptyFlow: '还没有步骤。添加一个 AI 步骤开始设计。', addAgent: '添加 AI 步骤', addDecision: '添加判断', addMerge: '合并结果', canvasHint: '拖动步骤并连接圆点', workflowName: '内部名称', humanTitle: '用户看到的名称', outcome: '这个工作流最终帮用户得到什么？', versions: '版本记录', currentVersion: '当前', restore: '恢复为新版本', restoring: '恢复中…', selectNode: '选择一个步骤来编辑', needsAttention: '发布前需要处理', stepSettings: '步骤设置', remove: '删除', stepName: '步骤名称', stepPurpose: '这一步的作用', instructions: '告诉 AI 要做什么', advanced: '高级设置', model: '模型（可选）', defaultModel: '使用智能默认值', valuePath: '要检查的值', condition: '判断条件', exists: '存在', equals: '等于', notEquals: '不等于', contains: '包含', compareValue: '比较值', combineAs: '合并方式', namedResults: '按步骤名称组织', listResults: '按列表组织', summaryTemplate: '结果摘要（可选）', autoSummary: '留空则自动生成', aiPlaceholder: '例如：增加一个风险评审步骤，并与方案分析并行', designing: '正在设计…', applyWithAi: '让 AI 修改', testGoal: '运行时要完成的目标', publish: '发布', publishAndRun: '发布并运行',
  } : {
    untitled: 'Untitled workflow', editTitle: 'Edit workflow', createTitle: 'Create workflow', subtitle: 'Describe the outcome, connect the steps, and run it. No code required.', close: 'Close', savingDraft: 'Saving draft…', savedDraft: 'Draft saved', draftError: 'Draft could not be saved', flowTitle: 'Workflow map', flowAria: 'Editable workflow step map', stepCount: (count: number) => `${count} steps · select a step to edit`, emptyFlow: 'No steps yet. Add an AI step to start designing.', addAgent: 'Add AI step', addDecision: 'Add decision', addMerge: 'Combine results', canvasHint: 'Drag steps and connect the dots', workflowName: 'Internal name', humanTitle: 'Name users see', outcome: 'What will this workflow help the user achieve?', versions: 'Version history', currentVersion: 'Current', restore: 'Restore as new', restoring: 'Restoring…', selectNode: 'Select a step to edit it', needsAttention: 'Needs attention before publishing', stepSettings: 'Step settings', remove: 'Remove', stepName: 'Step name', stepPurpose: 'Purpose of this step', instructions: 'Tell the AI what to do', advanced: 'Advanced settings', model: 'Model (optional)', defaultModel: 'Use smart default', valuePath: 'Value to check', condition: 'Condition', exists: 'Exists', equals: 'Equals', notEquals: 'Does not equal', contains: 'Contains', compareValue: 'Compare with', combineAs: 'Combine as', namedResults: 'Named results', listResults: 'List of results', summaryTemplate: 'Result summary (optional)', autoSummary: 'Leave blank to generate automatically', aiPlaceholder: 'For example: add a risk review in parallel with solution analysis', designing: 'Designing…', applyWithAi: 'Change with AI', testGoal: 'Goal for the first run', publish: 'Publish', publishAndRun: 'Publish & run',
  };
}
