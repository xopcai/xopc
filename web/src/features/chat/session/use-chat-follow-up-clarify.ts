import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
} from 'react';

import type { ClarifyPromptState } from '@/features/chat/composer/clarify-prompt';
import {
  clearClarifyPromptSnapshot,
  readClarifyPromptSnapshot,
  writeClarifyPromptSnapshot,
} from '@/features/chat/clarify/clarify-prompt-storage';
import { useChatSessionStore } from '@/features/chat/session/chat-session-store';
import {
  MAX_PENDING_FOLLOW_UPS,
  projectPendingFollowUps,
  type PendingFollowUp,
} from '@/features/chat/follow-up/pending-follow-up.types';
import { apiFetch } from '@/lib/fetch';
import { waitForEndpointTurnClaim } from '@/features/endpoint-tools/turn-claim';
import { apiUrl } from '@/lib/url';

export type ChatFollowUpClarifyApi = {
  clarifyPrompt: ClarifyPromptState | null;
  clarifySubmitting: boolean;
  clarifySubmitError: string | null;
  clarifyPromptRef: MutableRefObject<ClarifyPromptState | null>;
  pendingFollowUps: PendingFollowUp[];
  pendingFollowUpsRef: MutableRefObject<PendingFollowUp[]>;
  steeringFollowUpId: string | null;
  /** Row open in the composer for in-place edit (line stays in queue until commit). */
  editingFollowUpId: string | null;
  addPendingFollowUp: (
    content: string,
    attachments?: PendingFollowUp['attachments'],
  ) => Promise<void>;
  beginEditFollowUp: (id: string) => void;
  cancelEditFollowUp: () => void;
  commitEditFollowUp: (
    id: string,
    content: string,
    attachments?: PendingFollowUp['attachments'],
    levelOverride?: string,
  ) => void;
  removePendingFollowUp: (id: string) => void;
  movePendingFollowUp: (id: string, dir: 'up' | 'down') => void;
  reorderPendingFollowUp: (fromIndex: number, toIndex: number) => void;
  steerPendingFollowUp: (id: string) => Promise<void>;
  submitClarifyAnswer: (answer: string) => Promise<void>;
  cancelClarifyAnswer: () => Promise<void>;
  /** Clear visible clarify UI only (keep per-session storage). */
  clearVisibleClarify: () => void;
  dismissClarify: () => void;
  dismissClarifyForSession: (chatId: string) => void;
  clearPendingFollowUps: () => void;
  dismissClarifyAndClearPending: () => void;
  onClarifyToolEnd: (chatId: string) => void;
  makeOnClarifyRequest: (chatId: string) => (payload: ClarifyPromptState) => void;
};

export function useChatFollowUpClarify(options: {
  sessionKey: string | null;
  decodedKey: string | undefined;
  sessionKeyRef: MutableRefObject<string | null>;
  sendingRef: MutableRefObject<boolean>;
  streamingRef: MutableRefObject<boolean>;
  modelSupportsThinking: boolean;
  thinkingLevel: string;
  shouldApplyStreamUpdate: (streamSessionKey: string) => boolean;
}): ChatFollowUpClarifyApi {
  const {
    sessionKey,
    decodedKey,
    sessionKeyRef,
    sendingRef,
    streamingRef,
    modelSupportsThinking,
    thinkingLevel,
    shouldApplyStreamUpdate,
  } = options;

  const [clarifyPrompt, setClarifyPrompt] = useState<ClarifyPromptState | null>(null);
  const [clarifySubmitting, setClarifySubmitting] = useState(false);
  const [clarifySubmitError, setClarifySubmitError] = useState<string | null>(null);
  const clarifyPromptRef = useRef<ClarifyPromptState | null>(null);

  const [pendingFollowUps, setPendingFollowUps] = useState<PendingFollowUp[]>([]);
  const pendingFollowUpsRef = useRef<PendingFollowUp[]>([]);
  const [steeringFollowUpId, setSteeringFollowUpId] = useState<string | null>(null);
  const [editingFollowUpId, setEditingFollowUpId] = useState<string | null>(null);
  const editingFollowUpIdRef = useRef<string | null>(null);
  const revisionRef = useRef(-1);

  clarifyPromptRef.current = clarifyPrompt;
  pendingFollowUpsRef.current = pendingFollowUps;
  editingFollowUpIdRef.current = editingFollowUpId;

  const applyState = useCallback((raw: unknown) => {
    if (!raw || typeof raw !== 'object') return;
    const state = raw as { sessionKey?: unknown; revision?: unknown; inputs?: unknown };
    if (state.sessionKey !== sessionKeyRef.current || typeof state.revision !== 'number' || !Array.isArray(state.inputs)) return;
    if (state.revision < revisionRef.current) return;
    const rows = projectPendingFollowUps(state.inputs);
    revisionRef.current = state.revision;
    pendingFollowUpsRef.current = rows;
    setPendingFollowUps(rows);
    if (editingFollowUpIdRef.current && !rows.some((row) => row.id === editingFollowUpIdRef.current)) setEditingFollowUpId(null);
  }, [sessionKeyRef]);

  const refreshState = useCallback(async (key: string) => {
    const res = await apiFetch(apiUrl(`/api/sessions/${encodeURIComponent(key)}/input-state`)).catch(() => null);
    if (!res?.ok || sessionKeyRef.current !== key) return;
    const json = await res.json().catch(() => null) as { payload?: unknown } | null;
    applyState(json?.payload);
  }, [applyState, sessionKeyRef]);

  useEffect(() => {
    revisionRef.current = -1;
    pendingFollowUpsRef.current = [];
    setPendingFollowUps([]);
    setEditingFollowUpId(null);
    if (!sessionKey || sessionKey !== decodedKey) return;
    setClarifyPrompt(readClarifyPromptSnapshot(sessionKey));
    void refreshState(sessionKey);
  }, [decodedKey, refreshState, sessionKey]);

  useEffect(() => {
    const onState = (event: Event) => applyState((event as CustomEvent<unknown>).detail);
    const onReconnect = () => {
      const key = sessionKeyRef.current;
      if (key) void refreshState(key);
    };
    window.addEventListener('session-input-state', onState);
    window.addEventListener('gateway-realtime-connected', onReconnect);
    return () => {
      window.removeEventListener('session-input-state', onState);
      window.removeEventListener('gateway-realtime-connected', onReconnect);
    };
  }, [applyState, refreshState, sessionKeyRef]);

  const clearVisibleClarify = useCallback(() => {
    setClarifySubmitError(null);
    setClarifyPrompt(null);
  }, []);

  const dismissClarifyForSession = useCallback(
    (chatId: string) => {
      const key = String(chatId ?? '').trim();
      if (!key) return;
      clearClarifyPromptSnapshot(key);
      if (sessionKeyRef.current === key) {
        setClarifySubmitError(null);
        setClarifyPrompt(null);
      }
    },
    [sessionKeyRef],
  );

  const dismissClarify = useCallback(() => {
    const key = sessionKeyRef.current;
    if (key) clearClarifyPromptSnapshot(key);
    setClarifySubmitError(null);
    setClarifyPrompt(null);
  }, [sessionKeyRef]);

  const clearPendingFollowUps = useCallback(() => {
    setEditingFollowUpId(null);
  }, []);

  const dismissClarifyAndClearPending = useCallback(() => {
    const key = sessionKeyRef.current;
    if (key) {
      clearClarifyPromptSnapshot(key);
    }
    setClarifySubmitError(null);
    setClarifyPrompt(null);
    setEditingFollowUpId(null);
  }, [sessionKeyRef]);

  const onClarifyToolEnd = useCallback(
    (chatId: string) => {
      dismissClarifyForSession(chatId);
    },
    [dismissClarifyForSession],
  );

  const makeOnClarifyRequest = useCallback(
    (chatId: string) => (payload: ClarifyPromptState) => {
      writeClarifyPromptSnapshot(chatId, payload);
      if (!shouldApplyStreamUpdate(chatId)) return;
      sendingRef.current = false;
      streamingRef.current = false;
      useChatSessionStore.getState().setSessionFlags(chatId, { sending: false, streaming: false });
      useChatSessionStore.getState().setSessionProgress(chatId, null);
      setClarifySubmitError(null);
      setClarifyPrompt(payload);
    },
    [shouldApplyStreamUpdate, sendingRef, streamingRef],
  );

  const addPendingFollowUp = useCallback(
    async (
      content: string,
      attachments?: PendingFollowUp['attachments'],
    ) => {
      const trimmed = content.trim();
      if (!trimmed && !attachments?.length) return;
      if (pendingFollowUpsRef.current.length >= MAX_PENDING_FOLLOW_UPS) {
        throw new Error(`At most ${MAX_PENDING_FOLLOW_UPS} pending messages are allowed`);
      }
      const effectiveThinking = modelSupportsThinking ? thinkingLevel : 'off';
      const key = sessionKeyRef.current;
      if (!key) throw new Error('No active session');
      const origin = await waitForEndpointTurnClaim();
      const res = await apiFetch(apiUrl(`/api/sessions/${encodeURIComponent(key)}/inputs`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientMessageId: crypto.randomUUID(), delivery: 'next', content: trimmed || content,
          attachments: attachments?.length ? attachments : undefined, thinking: effectiveThinking,
        origin,
        }),
      });
      const json = await res.json().catch(() => null) as {
        payload?: { state?: unknown };
        error?: string | { message?: string };
      } | null;
      if (!res.ok) {
        const message = typeof json?.error === 'string' ? json.error : json?.error?.message;
        throw new Error(message ?? 'Message was not accepted');
      }
      if (!json?.payload?.state) throw new Error('Gateway returned an invalid input state');
      applyState(json.payload.state);
    },
    [applyState, modelSupportsThinking, sessionKeyRef, thinkingLevel],
  );

  const beginEditFollowUp = useCallback((id: string) => {
    setEditingFollowUpId(id);
  }, []);

  const cancelEditFollowUp = useCallback(() => {
    setEditingFollowUpId(null);
  }, []);

  const commitEditFollowUp = useCallback(
    (
      id: string,
      content: string,
      attachments?: PendingFollowUp['attachments'],
      levelOverride?: string,
    ) => {
      const trimmed = content.trim();
      const prev = pendingFollowUpsRef.current;
      const i = prev.findIndex((r) => r.id === id);
      if (i < 0) {
        setEditingFollowUpId(null);
        return;
      }
      if (!trimmed && !attachments?.length) {
        const key = sessionKeyRef.current;
        if (key) void apiFetch(apiUrl(`/api/sessions/${encodeURIComponent(key)}/inputs/${encodeURIComponent(id)}?version=${prev[i].version}`), { method: 'DELETE' })
          .then(async (res) => applyState((await res.json().catch(() => null) as { payload?: unknown } | null)?.payload))
          .catch(() => { void refreshState(key); });
        setEditingFollowUpId(null);
        return;
      }
      const effThinking = modelSupportsThinking ? (levelOverride ?? thinkingLevel) : 'off';
      setEditingFollowUpId(null);
      const key = sessionKeyRef.current;
      if (!key) return;
      void apiFetch(apiUrl(`/api/sessions/${encodeURIComponent(key)}/inputs/${encodeURIComponent(id)}`), {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: prev[i].version, content: trimmed || content,
          attachments: attachments?.length ? attachments : undefined, thinking: effThinking }),
      }).then(async (res) => {
        const json = await res.json().catch(() => null) as { payload?: unknown } | null;
        applyState(json?.payload);
      }).catch(() => { void refreshState(key); });
    },
    [applyState, modelSupportsThinking, refreshState, sessionKeyRef, thinkingLevel],
  );

  const removePendingFollowUp = useCallback((id: string) => {
    if (editingFollowUpIdRef.current === id) {
      setEditingFollowUpId(null);
    }
    const key = sessionKeyRef.current;
    const row = pendingFollowUpsRef.current.find((item) => item.id === id);
    if (!key || !row) return;
    void apiFetch(apiUrl(`/api/sessions/${encodeURIComponent(key)}/inputs/${encodeURIComponent(id)}?version=${row.version}`), {
      method: 'DELETE',
    }).then(async (res) => {
      const json = await res.json().catch(() => null) as { payload?: unknown } | null;
      applyState(json?.payload);
    }).catch(() => { void refreshState(key); });
  }, [applyState, refreshState, sessionKeyRef]);

  const movePendingFollowUp = useCallback((id: string, dir: 'up' | 'down') => {
    const queued = pendingFollowUpsRef.current.filter((row) => row.status === 'queued');
    const i = queued.findIndex((row) => row.id === id);
    if (i < 0) return;
    const target = dir === 'up' ? i - 1 : i + 1;
    const key = sessionKeyRef.current;
    const row = queued[i];
    if (!key || !row || target < 0 || target >= queued.length) return;
    void apiFetch(apiUrl(`/api/sessions/${encodeURIComponent(key)}/inputs/${encodeURIComponent(row.id)}`), {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: row.version, position: target }),
    }).then(async (res) => applyState((await res.json().catch(() => null) as { payload?: unknown } | null)?.payload))
      .catch(() => { void refreshState(key); });
  }, [applyState, refreshState, sessionKeyRef]);

  const reorderPendingFollowUp = useCallback((fromIndex: number, toIndex: number) => {
    const key = sessionKeyRef.current;
    const row = pendingFollowUpsRef.current[fromIndex];
    const targetRow = pendingFollowUpsRef.current[toIndex];
    const queued = pendingFollowUpsRef.current.filter((item) => item.status === 'queued');
    const position = targetRow ? queued.findIndex((item) => item.id === targetRow.id) : -1;
    if (!key || row?.status !== 'queued' || targetRow?.status !== 'queued' || position < 0) return;
    void apiFetch(apiUrl(`/api/sessions/${encodeURIComponent(key)}/inputs/${encodeURIComponent(row.id)}`), {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: row.version, position }),
    }).then(async (res) => {
      const json = await res.json().catch(() => null) as { payload?: unknown } | null;
      applyState(json?.payload);
    }).catch(() => { void refreshState(key); });
  }, [applyState, refreshState, sessionKeyRef]);

  const steerPendingFollowUp = useCallback(async (id: string) => {
    const key = sessionKeyRef.current;
    if (!key) return;
    const row = pendingFollowUpsRef.current.find((r) => r.id === id);
    if (!row?.text.trim() || row.attachments?.length) return;
    setSteeringFollowUpId(id);
    try {
      const res = await apiFetch(apiUrl(`/api/sessions/${encodeURIComponent(key)}/inputs`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientMessageId: crypto.randomUUID(), delivery: 'steer', content: row.text.trim() }),
      });
      if (res.ok) {
        const json = await res.json().catch(() => null) as { payload?: { state?: unknown } } | null;
        applyState(json?.payload?.state);
        removePendingFollowUp(id);
      }
    } catch {
      /* ignore */
    } finally {
      setSteeringFollowUpId(null);
    }
  }, [applyState, removePendingFollowUp, sessionKeyRef]);

  const submitClarifyAnswer = useCallback(async (answer: string) => {
    const p = clarifyPromptRef.current;
    if (!p) return;
    setClarifySubmitting(true);
    setClarifySubmitError(null);
    try {
      const res = await apiFetch(apiUrl(`/api/clarify/${encodeURIComponent(p.requestId)}`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answer }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        setClarifySubmitError(j.error?.message ?? res.statusText ?? 'Clarify failed');
        return;
      }
      const key = sessionKeyRef.current;
      if (key) clearClarifyPromptSnapshot(key);
      setClarifyPrompt(null);
      setClarifySubmitError(null);
    } finally {
      setClarifySubmitting(false);
    }
  }, [sessionKeyRef]);

  const cancelClarifyAnswer = useCallback(async () => {
    const p = clarifyPromptRef.current;
    if (!p) return;
    setClarifySubmitting(true);
    setClarifySubmitError(null);
    try {
      const res = await apiFetch(apiUrl(`/api/clarify/${encodeURIComponent(p.requestId)}`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skip: true }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        setClarifySubmitError(j.error?.message ?? res.statusText ?? 'Clarify failed');
        return;
      }
      const key = sessionKeyRef.current;
      if (key) clearClarifyPromptSnapshot(key);
      setClarifyPrompt(null);
      setClarifySubmitError(null);
    } finally {
      setClarifySubmitting(false);
    }
  }, [sessionKeyRef]);

  return {
    clarifyPrompt,
    clarifySubmitting,
    clarifySubmitError,
    clarifyPromptRef,
    pendingFollowUps,
    pendingFollowUpsRef,
    steeringFollowUpId,
    editingFollowUpId,
    addPendingFollowUp,
    beginEditFollowUp,
    cancelEditFollowUp,
    commitEditFollowUp,
    removePendingFollowUp,
    movePendingFollowUp,
    reorderPendingFollowUp,
    steerPendingFollowUp,
    submitClarifyAnswer,
    cancelClarifyAnswer,
    clearVisibleClarify,
    dismissClarify,
    dismissClarifyForSession,
    clearPendingFollowUps,
    dismissClarifyAndClearPending,
    onClarifyToolEnd,
    makeOnClarifyRequest,
  };
}
