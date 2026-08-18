import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';

import { apiFetch } from '../../api/client';
import { subscribeGatewayEvent } from '../gateway/gateway-event-bus';
import { getSessionInputState, submitSessionInput } from './follow-up-agent-api';
import {
  MAX_PENDING_FOLLOW_UPS,
  projectPendingFollowUps,
  type PendingFollowUp,
} from './pending-follow-up.types';
import { newFollowUpRowId } from './follow-up-utils';

export type ChatFollowUpApi = {
  pendingFollowUps: PendingFollowUp[];
  steeringFollowUpId: string | null;
  editingFollowUpId: string | null;
  addPendingFollowUp: (content: string, attachments?: PendingFollowUp['attachments']) => Promise<void>;
  beginEditFollowUp: (id: string) => void;
  cancelEditFollowUp: () => void;
  commitEditFollowUp: (id: string, content: string, attachments?: PendingFollowUp['attachments']) => void;
  removePendingFollowUp: (id: string) => void;
  movePendingFollowUp: (id: string, dir: 'up' | 'down') => void;
  reorderPendingFollowUp: (fromIndex: number, toIndex: number) => void;
  steerPendingFollowUp: (id: string) => Promise<void>;
  clearPendingFollowUps: () => void;
};

function parseState(value: unknown): { sessionKey: string; revision: number; rows: PendingFollowUp[] } | null {
  if (!value || typeof value !== 'object') return null;
  const state = value as Record<string, unknown>;
  if (typeof state.sessionKey !== 'string' || typeof state.revision !== 'number' || !Array.isArray(state.inputs)) return null;
  const rows = projectPendingFollowUps(state.inputs);
  return { sessionKey: state.sessionKey, revision: state.revision, rows };
}

export function useChatFollowUp(options: {
  sessionKey: string | null;
  sessionKeyRef: MutableRefObject<string | null>;
  onQueueFull?: () => void;
}): ChatFollowUpApi {
  const { sessionKey, sessionKeyRef, onQueueFull } = options;
  const [pendingFollowUps, setPendingFollowUps] = useState<PendingFollowUp[]>([]);
  const rowsRef = useRef<PendingFollowUp[]>([]);
  const revisionRef = useRef(-1);
  const [steeringFollowUpId, setSteeringFollowUpId] = useState<string | null>(null);
  const [editingFollowUpId, setEditingFollowUpId] = useState<string | null>(null);

  const applyState = useCallback((raw: unknown) => {
    const parsed = parseState(raw);
    if (!parsed || parsed.sessionKey !== sessionKeyRef.current || parsed.revision < revisionRef.current) return;
    revisionRef.current = parsed.revision;
    rowsRef.current = parsed.rows;
    setPendingFollowUps(parsed.rows);
    setEditingFollowUpId((id) => id && parsed.rows.some((row) => row.id === id) ? id : null);
  }, [sessionKeyRef]);

  const refresh = useCallback(async (key: string) => {
    try { applyState(await getSessionInputState(key)); } catch { /* reconnect retries */ }
  }, [applyState]);

  useEffect(() => {
    revisionRef.current = -1;
    rowsRef.current = [];
    setPendingFollowUps([]);
    setEditingFollowUpId(null);
    if (sessionKey) void refresh(sessionKey);
  }, [refresh, sessionKey]);

  useEffect(() => {
    const unsubscribeState = subscribeGatewayEvent('session.input-state', applyState);
    const unsubscribeConnected = subscribeGatewayEvent('gateway.sse-connected', () => {
      const key = sessionKeyRef.current;
      if (key) void refresh(key);
    });
    return () => {
      unsubscribeState();
      unsubscribeConnected();
    };
  }, [applyState, refresh, sessionKeyRef]);

  const addPendingFollowUp = useCallback(async (content: string, attachments?: PendingFollowUp['attachments']) => {
    const key = sessionKeyRef.current;
    if (!content.trim() && !attachments?.length) return;
    if (!key) throw new Error('No active session');
    if (rowsRef.current.length >= MAX_PENDING_FOLLOW_UPS) {
      onQueueFull?.();
      throw new Error(`At most ${MAX_PENDING_FOLLOW_UPS} pending messages are allowed`);
    }
    applyState(await submitSessionInput(key, { clientMessageId: newFollowUpRowId(), delivery: 'next',
      content: content.trim() || content, attachments }));
  }, [applyState, onQueueFull, sessionKeyRef]);

  const removePendingFollowUp = useCallback((id: string) => {
    const key = sessionKeyRef.current;
    const row = rowsRef.current.find((item) => item.id === id);
    if (!key || !row) return;
    void apiFetch(`/api/sessions/${encodeURIComponent(key)}/inputs/${encodeURIComponent(id)}?version=${row.version}`, { method: 'DELETE' })
      .then((res) => res.json()).then((json: { payload?: unknown }) => applyState(json.payload)).catch(() => { void refresh(key); });
  }, [applyState, refresh, sessionKeyRef]);

  const reorderPendingFollowUp = useCallback((fromIndex: number, toIndex: number) => {
    const key = sessionKeyRef.current;
    const row = rowsRef.current[fromIndex];
    const targetRow = rowsRef.current[toIndex];
    const queued = rowsRef.current.filter((item) => item.status === 'queued');
    const position = targetRow ? queued.findIndex((item) => item.id === targetRow.id) : -1;
    if (!key || row?.status !== 'queued' || targetRow?.status !== 'queued' || position < 0) return;
    void apiFetch(`/api/sessions/${encodeURIComponent(key)}/inputs/${encodeURIComponent(row.id)}`, {
      method: 'PATCH', body: JSON.stringify({ version: row.version, position }),
    }).then((res) => res.json()).then((json: { payload?: unknown }) => applyState(json.payload)).catch(() => { void refresh(key); });
  }, [applyState, refresh, sessionKeyRef]);

  const commitEditFollowUp = useCallback((id: string, content: string, attachments?: PendingFollowUp['attachments']) => {
    const key = sessionKeyRef.current;
    const row = rowsRef.current.find((item) => item.id === id);
    setEditingFollowUpId(null);
    if (!key || !row) return;
    if (!content.trim() && !attachments?.length) { removePendingFollowUp(id); return; }
    void apiFetch(`/api/sessions/${encodeURIComponent(key)}/inputs/${encodeURIComponent(id)}`, {
      method: 'PATCH', body: JSON.stringify({ version: row.version, content: content.trim() || content, attachments }),
    }).then((res) => res.json()).then((json: { payload?: unknown }) => applyState(json.payload)).catch(() => { void refresh(key); });
  }, [applyState, refresh, removePendingFollowUp, sessionKeyRef]);

  const steerPendingFollowUp = useCallback(async (id: string) => {
    const key = sessionKeyRef.current;
    const row = rowsRef.current.find((item) => item.id === id);
    if (!key || !row?.text.trim() || row.attachments?.length) return;
    setSteeringFollowUpId(id);
    try {
      applyState(await submitSessionInput(key, { clientMessageId: newFollowUpRowId(), delivery: 'steer', content: row.text.trim() }));
      removePendingFollowUp(id);
    } finally { setSteeringFollowUpId(null); }
  }, [applyState, removePendingFollowUp, sessionKeyRef]);

  return {
    pendingFollowUps, steeringFollowUpId, editingFollowUpId, addPendingFollowUp,
    beginEditFollowUp: setEditingFollowUpId, cancelEditFollowUp: () => setEditingFollowUpId(null),
    commitEditFollowUp, removePendingFollowUp,
    movePendingFollowUp: (id, dir) => {
      const queued = rowsRef.current.filter((row) => row.status === 'queued');
      const queuedIndex = queued.findIndex((row) => row.id === id);
      const target = queued[dir === 'up' ? queuedIndex - 1 : queuedIndex + 1];
      if (queuedIndex < 0 || !target) return;
      reorderPendingFollowUp(
        rowsRef.current.findIndex((row) => row.id === id),
        rowsRef.current.findIndex((row) => row.id === target.id),
      );
    },
    reorderPendingFollowUp, steerPendingFollowUp,
    clearPendingFollowUps: () => setEditingFollowUpId(null),
  };
}
