import { AsyncLocalStorage } from 'node:async_hooks';

import { SpaceWorkbookReferenceSchema } from '@xopcai/gateway-contract';

import type { AgentSourceContext } from '../agent/source-context/types.js';
import { currentDeviceExecutionActor } from '../endpoint-tools/execution-actor.js';
import { hasGatewayScope } from '../gateway/security/gateway-scopes.js';
import { DurableState } from '../storage/sqlite/durable-state.js';
import { getSqliteDatabase } from '../storage/sqlite/transaction.js';
import { findSpaceWorkbookByTitle, loadSpaceWorkbook } from './budget-workbook.js';

type WorkbookTurn = { conversationId: string; runId: string; text: string; sources: readonly AgentSourceContext[]; signal?: AbortSignal };
const workbookTurn = new AsyncLocalStorage<WorkbookTurn>();
const bindings = new DurableState<{ transcriptId: string; id: string }>('space.workbook-conversation');

export function withWorkbookTurn<T>(turn: WorkbookTurn, run: () => T): T {
  return workbookTurn.run(turn, run);
}

export function currentWorkbookTurn(conversationId: string, write = false) {
  const turn = workbookTurn.getStore();
  const actor = turn?.conversationId === conversationId ? currentDeviceExecutionActor(conversationId, turn.runId) : undefined;
  const scope = write ? 'workspace.write' : 'workspace.read';
  if (!turn || turn.signal?.aborted || !actor || !hasGatewayScope(actor.scopes, scope)) {
    throw new Error('Workbook access is unavailable for this turn. Use an authorized interactive conversation.');
  }
  return turn;
}

function priorWorkbook(conversationId: string) {
  const active = getSqliteDatabase().prepare('SELECT active_transcript_id AS id FROM sessions WHERE conversation_id = ?').get(conversationId);
  const binding = bindings.get(conversationId);
  if (binding && binding.transcriptId === active?.id) return binding.id;
  const row = getSqliteDatabase().prepare(`SELECT json_extract(context.value, '$.sourceId') AS id
    FROM sessions s JOIN transcript_entries e ON e.transcript_id = s.active_transcript_id,
    json_each(json_extract(e.payload_json, '$.metadata.sourceContexts')) context
    WHERE s.conversation_id = ? AND e.role = 'user' AND json_extract(context.value, '$.kind') = 'workbook'
    ORDER BY e.seq DESC LIMIT 1`).get(conversationId);
  return typeof row?.id === 'string' ? row.id : undefined;
}

function rememberWorkbook(conversationId: string, id: string) {
  const active = getSqliteDatabase().prepare('SELECT active_transcript_id AS id FROM sessions WHERE conversation_id = ?').get(conversationId);
  if (typeof active?.id === 'string') bindings.set(conversationId, { transcriptId: active.id, id });
}

export function workbookForTurn(turn: WorkbookTurn, title?: string, versionId?: string) {
  if (title) {
    if (!turn.text.toLowerCase().includes(title.toLowerCase())) throw new Error('Use the workbook title from the user’s current request.');
    const matches = findSpaceWorkbookByTitle(title);
    if (matches.length !== 1) throw new Error('Choose the intended workbook in Space or attach it to this conversation.');
    const stored = loadSpaceWorkbook(matches[0].id, versionId);
    if (stored) rememberWorkbook(turn.conversationId, stored.id);
    return stored;
  }
  const refs = turn.sources.filter(context => context.kind === 'workbook');
  const [current] = refs;
  if (refs.length > 1) throw new Error('The user attached multiple workbooks. Ask which one to use.');
  const id = current?.sourceId ?? priorWorkbook(turn.conversationId);
  if (!id) throw new Error('Open the workbook from Space or specify its exact title in the conversation.');
  const stored = loadSpaceWorkbook(id, versionId ?? current?.version);
  if (stored && current) rememberWorkbook(turn.conversationId, stored.id);
  return stored;
}

export function workbookReferenceContext(id: string, versionId?: string): AgentSourceContext | null {
  const ref = SpaceWorkbookReferenceSchema.safeParse({ id, versionId });
  if (!ref.success) return null;
  const stored = loadSpaceWorkbook(id, versionId);
  if (!stored) return null;
  return { kind: 'workbook', sourceId: id, version: stored.versionId, title: stored.title,
    text: `${JSON.stringify(stored.title)}. Use workbook_read for sheet names, cell values, formulas and source links. Use workbook_edit to simulate a change on a temporary copy.` };
}
