import type { AgentMessage } from '@earendil-works/pi-agent-core';

import { DurableState } from '../../storage/sqlite/durable-state.js';
import { isXopcDatabaseOpen } from '../../storage/sqlite/connection.js';
import { queueEmbeddedSteer } from '../embedded/runs.js';
import { redactSensitiveOutput } from '../../utils/logger.js';

export interface ChildRunView {
  id: string;
  parentConversationId: string;
  task: string;
  status: 'running' | 'success' | 'partial' | 'failed' | 'cancelled' | 'interrupted';
  output: string;
  startedAt: number;
  workspace?: string;
  modelRef?: string;
  agentId?: string;
  allowedTools?: string[];
  maxIterations?: number;
}

type Entry = { view: ChildRunView; abort: () => void };
interface ChildRecord { view: ChildRunView; messages: AgentMessage[] }
const records = (owner: string) => new DurableState<ChildRecord>('child-run-monitor', owner);
const save = (view: ChildRunView, messages?: AgentMessage[]) => {
  if (!isXopcDatabaseOpen() || !view.parentConversationId) return;
  const store = records(view.parentConversationId);
  store.set(view.id, { view: { ...view }, messages: messages ?? store.get(view.id)?.messages ?? [] });
};
const monitorKey = Symbol.for('xopc.child-run-monitor');
const entries = (): Map<string, Entry> => {
  const store = globalThis as Record<symbol, unknown>;
  return (store[monitorKey] ??= new Map<string, Entry>()) as Map<string, Entry>;
};

export function monitorChildRun(input: { id: string; parentConversationId?: string; task: string; abort: () => void; workspace?: string; modelRef?: string; agentId?: string; allowedTools?: string[]; maxIterations?: number }) {
  const view: ChildRunView = { id: input.id, parentConversationId: input.parentConversationId ?? '',
    workspace: input.workspace, modelRef: input.modelRef, agentId: input.agentId, allowedTools: input.allowedTools, maxIterations: input.maxIterations, task: redactSensitiveOutput(input.task).slice(0, 1000), status: 'running', output: '', startedAt: Date.now() };
  const store = entries();
  if (view.parentConversationId) {
    for (const [id, entry] of store) {
      if (store.size < 200) break;
      if (entry.view.status !== 'running') store.delete(id);
    }
    store.set(view.id, { view, abort: input.abort });
  }
  save(view);
  let lastSavedAt = 0;
  return {
    snapshot(messages: AgentMessage[]) { save(view, messages); },
    append(text: string) { view.output = (view.output + redactSensitiveOutput(text)).slice(-24000); if (Date.now() - lastSavedAt > 250) { save(view); lastSavedAt = Date.now(); } },
    finish(status: ChildRunView['status'], summary: string) {
      view.status = status;
      view.output = (view.output + '\n\n' + redactSensitiveOutput(summary)).slice(-24000);
      save(view);
    },
    dispose() { if (view.status === 'running') view.status = 'failed'; save(view); },
  };
}

export function listChildRuns(parentConversationId: string): ChildRunView[] {
  const views = new Map<string, ChildRunView>();
  if (isXopcDatabaseOpen()) for (const record of records(parentConversationId).values()) {
    const view = { ...record.view };
    if (view.status === 'running' && !entries().has(view.id)) { view.status = 'interrupted'; save(view); }
    views.set(view.id, view);
  }
  for (const entry of entries().values()) if (entry.view.parentConversationId === parentConversationId) views.set(entry.view.id, { ...entry.view });
  return [...views.values()].sort((a, b) => b.startedAt - a.startedAt);
}

export function getChildRun(parentConversationId: string, id: string): ChildRunView {
  const view = listChildRuns(parentConversationId).find(view => view.id === id);
  if (!view) throw new Error('Subagent not found in this conversation.');
  return view;
}

export function getChildRunMessages(parentConversationId: string, id: string): AgentMessage[] {
  getChildRun(parentConversationId, id);
  return isXopcDatabaseOpen() ? records(parentConversationId).get(id)?.messages ?? [] : [];
}

export async function steerChildRun(parentConversationId: string, id: string, text: string): Promise<void> {
  const view = getChildRun(parentConversationId, id);
  if (view.status !== 'running' || !text.trim() || text.length > 32000) throw new Error('Steering requires a running child and 1–32000 characters.');
  if (!await queueEmbeddedSteer(id, text)) throw new Error('Child is not ready to accept input; retry after it starts.');
}

export function stopChildRun(parentConversationId: string, id: string): void {
  getChildRun(parentConversationId, id);
  const entry = entries().get(id)!;
  if (entry?.view.status === 'running') entry.abort();
}
