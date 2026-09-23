import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
} from 'react';

import type { ClarifyPromptState } from '@/features/chat/composer/clarify-prompt';
import type { ComposerContextRef } from '@/features/chat/composer/composer.types';
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
    contextRefs?: ComposerContextRef[],
  ) => Promise<void>;
  beginEditFollowUp: (id: string) => void;
  cancelEditFollowUp: () => void;
  commitEditFollowUp: (
    id: string,
    content: string,
    attachments?: PendingFollowUp['attachments'],
    levelOverride?: string,
    contextRefs?: ComposerContextRef[],
  ) => void;
  removePendingFollowUp: (id: string) => void;
  movePendingFollowUp: (id: string, dir: 'up' | 'down') => void;
  reorderPendingFollowUp: (fromIndex: number, toIndex: number) => void;
  steerPendingFollowUp: (id: string) => Promise<void>;
  submitClarifyAnswer: (answer: string) => Promise<void>;
  letAgentDecideClarification: () => Promise<void>;
  cancelClarification: () => Promise<void>;
  clearVisibleClarify: () => void;
  dismissClarify: () => void;
  dismissClarifyForSession: (chatId: string) => void;
  clearPendingFollowUps: () => void;
  dismissClarifyAndClearPending: () => void;
  makeOnClarifyRequest: (chatId: string) => (payload: ClarifyPromptState) => void;
};

function parseClarification(raw: unknown, expectedConversationId?: string): ClarifyPromptState | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const value = record.clarification && typeof record.clarification === 'object'
    ? record.clarification as Record<string, unknown>
    : record;
  if (value.status !== undefined && value.status !== 'open') return null;
  if (expectedConversationId && typeof value.conversationId === 'string' && value.conversationId !== expectedConversationId) return null;
  const requestId = typeof value.id === 'string' ? value.id : value.requestId;
  const question = value.question;
  const kind = value.kind === 'approval' ? 'approval' : 'input';
  const choices = Array.isArray(value.choices)
    ? value.choices.filter((choice): choice is string => typeof choice === 'string' && Boolean(choice.trim()))
    : undefined;
  if (typeof requestId !== 'string' || !requestId.trim() || typeof question !== 'string' || !question.trim()) return null;
  return {
    requestId: requestId.trim(),
    kind,
    question: question.trim(),
    choices: choices && choices.length >= 2 ? choices : undefined,
    suggestedAnswer: typeof value.suggestedAnswer === 'string' && value.suggestedAnswer.trim()
      ? value.suggestedAnswer.trim()
      : undefined,
    version: typeof value.version === 'number' ? value.version : 1,
    createdAt: typeof value.createdAt === 'number' ? value.createdAt : Date.now(),
    expiresAt: typeof value.expiresAt === 'number' ? value.expiresAt : undefined,
  };
}

export function useChatFollowUpClarify(options: {
  conversationId: string | null;
  decodedKey: string | undefined;
  conversationIdRef: MutableRefObject<string | null>;
  sendingRef: MutableRefObject<boolean>;
  streamingRef: MutableRefObject<boolean>;
  modelSupportsThinking: boolean;
  thinkingLevel: string;
  shouldApplyStreamUpdate: (streamConversationId: string) => boolean;
}): ChatFollowUpClarifyApi {
  const {
    conversationId,
    decodedKey,
    conversationIdRef,
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
  const clarificationAttemptRef = useRef<{ signature: string; idempotencyKey: string } | null>(null);

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
    const state = raw as { conversationId?: unknown; revision?: unknown; inputs?: unknown };
    if (state.conversationId !== conversationIdRef.current || typeof state.revision !== 'number' || !Array.isArray(state.inputs)) return;
    if (state.revision < revisionRef.current) return;
    const rows = projectPendingFollowUps(state.inputs);
    revisionRef.current = state.revision;
    pendingFollowUpsRef.current = rows;
    setPendingFollowUps(rows);
    if (editingFollowUpIdRef.current && !rows.some((row) => row.id === editingFollowUpIdRef.current)) setEditingFollowUpId(null);
  }, [conversationIdRef]);

  const refreshState = useCallback(async (key: string) => {
    const res = await apiFetch(apiUrl(`/api/sessions/${encodeURIComponent(key)}/input-state`)).catch(() => null);
    if (!res?.ok || conversationIdRef.current !== key) return;
    const json = await res.json().catch(() => null) as { payload?: unknown } | null;
    applyState(json?.payload);
  }, [applyState, conversationIdRef]);

  const refreshClarification = useCallback(async (key: string) => {
    const res = await apiFetch(apiUrl(`/api/sessions/${encodeURIComponent(key)}/clarification`)).catch(() => null);
    if (!res?.ok || conversationIdRef.current !== key) return;
    const json = await res.json().catch(() => null) as { payload?: unknown } | null;
    setClarifySubmitError(null);
    setClarifyPrompt(parseClarification(json?.payload, key));
    clarificationAttemptRef.current = null;
  }, [conversationIdRef]);

  useEffect(() => {
    revisionRef.current = -1;
    pendingFollowUpsRef.current = [];
    setPendingFollowUps([]);
    setEditingFollowUpId(null);
    setClarifyPrompt(null);
    if (!conversationId || conversationId !== decodedKey) return;
    void refreshState(conversationId);
    void refreshClarification(conversationId);
  }, [decodedKey, refreshClarification, refreshState, conversationId]);

  useEffect(() => {
    const onState = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail;
      applyState(detail);
      const key = conversationIdRef.current;
      if (key && detail && typeof detail === 'object' && (detail as { conversationId?: unknown }).conversationId === key) {
        void refreshClarification(key);
      }
    };
    const onClarification = (event: Event) => {
      const key = conversationIdRef.current;
      if (!key) return;
      const detail = (event as CustomEvent<unknown>).detail;
      if (detail && typeof detail === 'object') {
        const eventConversationId = (detail as Record<string, unknown>).conversationId;
        if (typeof eventConversationId === 'string' && eventConversationId !== key) return;
      }
      setClarifySubmitError(null);
      setClarifyPrompt(parseClarification(detail, key));
      clarificationAttemptRef.current = null;
    };
    const onReconnect = () => {
      const key = conversationIdRef.current;
      if (key) {
        void refreshState(key);
        void refreshClarification(key);
      }
    };
    window.addEventListener('session-input-state', onState);
    window.addEventListener('clarification-updated', onClarification);
    window.addEventListener('gateway-realtime-connected', onReconnect);
    return () => {
      window.removeEventListener('session-input-state', onState);
      window.removeEventListener('clarification-updated', onClarification);
      window.removeEventListener('gateway-realtime-connected', onReconnect);
    };
  }, [applyState, refreshClarification, refreshState, conversationIdRef]);

  useEffect(() => {
    if (!clarifyPrompt?.expiresAt) return;
    const delay = Math.max(0, clarifyPrompt.expiresAt - Date.now()) + 250;
    const timer = window.setTimeout(() => {
      const key = conversationIdRef.current;
      if (key) void refreshClarification(key);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [clarifyPrompt?.expiresAt, refreshClarification, conversationIdRef]);

  const clearVisibleClarify = useCallback(() => {
    setClarifySubmitError(null);
    setClarifyPrompt(null);
  }, []);

  const dismissClarifyForSession = useCallback(
    (chatId: string) => {
      const key = String(chatId ?? '').trim();
      if (!key) return;
      if (conversationIdRef.current === key) {
        setClarifySubmitError(null);
        setClarifyPrompt(null);
      }
    },
    [conversationIdRef],
  );

  const dismissClarify = useCallback(() => {
    setClarifySubmitError(null);
    setClarifyPrompt(null);
  }, []);

  const clearPendingFollowUps = useCallback(() => {
    setEditingFollowUpId(null);
  }, []);

  const dismissClarifyAndClearPending = useCallback(() => {
    setClarifySubmitError(null);
    setClarifyPrompt(null);
    setEditingFollowUpId(null);
  }, []);

  const makeOnClarifyRequest = useCallback(
    (chatId: string) => (payload: ClarifyPromptState) => {
      if (!shouldApplyStreamUpdate(chatId)) return;
      sendingRef.current = false;
      streamingRef.current = false;
      useChatSessionStore.getState().setSessionFlags(chatId, { sending: false, streaming: false });
      useChatSessionStore.getState().setSessionProgress(chatId, null);
      setClarifySubmitError(null);
      setClarifyPrompt(payload);
      clarificationAttemptRef.current = null;
    },
    [shouldApplyStreamUpdate, sendingRef, streamingRef],
  );

  const addPendingFollowUp = useCallback(
    async (
      content: string,
      attachments?: PendingFollowUp['attachments'],
      contextRefs?: ComposerContextRef[],
    ) => {
      const trimmed = content.trim();
      if (!trimmed && !attachments?.length && !contextRefs?.length) return;
      if (pendingFollowUpsRef.current.length >= MAX_PENDING_FOLLOW_UPS) {
        throw new Error(`At most ${MAX_PENDING_FOLLOW_UPS} pending messages are allowed`);
      }
      const effectiveThinking = modelSupportsThinking ? thinkingLevel : 'off';
      const key = conversationIdRef.current;
      if (!key) throw new Error('No active session');
      const origin = await waitForEndpointTurnClaim();
      const res = await apiFetch(apiUrl(`/api/sessions/${encodeURIComponent(key)}/inputs`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          configVersion: useChatSessionStore.getState().sessions[key]?.configVersion,
          clientMessageId: crypto.randomUUID(), delivery: 'next', content: trimmed || content,
          attachments: attachments?.length ? attachments : undefined, thinking: effectiveThinking,
          contextRefs: contextRefs?.map(({ refId, kind, sourceId, expectedVersion }) => ({ refId, kind, sourceId, expectedVersion })),
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
    [applyState, modelSupportsThinking, conversationIdRef, thinkingLevel],
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
      contextRefs?: ComposerContextRef[],
    ) => {
      const trimmed = content.trim();
      const prev = pendingFollowUpsRef.current;
      const i = prev.findIndex((r) => r.id === id);
      if (i < 0) {
        setEditingFollowUpId(null);
        return;
      }
      if (!trimmed && !attachments?.length && !contextRefs?.length) {
        const key = conversationIdRef.current;
        if (key) void apiFetch(apiUrl(`/api/sessions/${encodeURIComponent(key)}/inputs/${encodeURIComponent(id)}?version=${prev[i].version}`), { method: 'DELETE' })
          .then(async (res) => applyState((await res.json().catch(() => null) as { payload?: unknown } | null)?.payload))
          .catch(() => { void refreshState(key); });
        setEditingFollowUpId(null);
        return;
      }
      const effThinking = modelSupportsThinking ? (levelOverride ?? thinkingLevel) : 'off';
      setEditingFollowUpId(null);
      const key = conversationIdRef.current;
      if (!key) return;
      void apiFetch(apiUrl(`/api/sessions/${encodeURIComponent(key)}/inputs/${encodeURIComponent(id)}`), {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: prev[i].version, content: trimmed || content,
          attachments: attachments?.length ? attachments : undefined, thinking: effThinking,
          contextRefs: (contextRefs ?? []).map(({ refId, kind, sourceId, expectedVersion }) => ({ refId, kind, sourceId, expectedVersion })),
        }),
      }).then(async (res) => {
        const json = await res.json().catch(() => null) as { payload?: unknown } | null;
        applyState(json?.payload);
      }).catch(() => { void refreshState(key); });
    },
    [applyState, modelSupportsThinking, refreshState, conversationIdRef, thinkingLevel],
  );

  const removePendingFollowUp = useCallback((id: string) => {
    if (editingFollowUpIdRef.current === id) {
      setEditingFollowUpId(null);
    }
    const key = conversationIdRef.current;
    const row = pendingFollowUpsRef.current.find((item) => item.id === id);
    if (!key || !row) return;
    void apiFetch(apiUrl(`/api/sessions/${encodeURIComponent(key)}/inputs/${encodeURIComponent(id)}?version=${row.version}`), {
      method: 'DELETE',
    }).then(async (res) => {
      const json = await res.json().catch(() => null) as { payload?: unknown } | null;
      applyState(json?.payload);
    }).catch(() => { void refreshState(key); });
  }, [applyState, refreshState, conversationIdRef]);

  const movePendingFollowUp = useCallback((id: string, dir: 'up' | 'down') => {
    const queued = pendingFollowUpsRef.current.filter((row) => row.status === 'queued');
    const i = queued.findIndex((row) => row.id === id);
    if (i < 0) return;
    const target = dir === 'up' ? i - 1 : i + 1;
    const key = conversationIdRef.current;
    const row = queued[i];
    if (!key || !row || target < 0 || target >= queued.length) return;
    void apiFetch(apiUrl(`/api/sessions/${encodeURIComponent(key)}/inputs/${encodeURIComponent(row.id)}`), {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: row.version, position: target }),
    }).then(async (res) => applyState((await res.json().catch(() => null) as { payload?: unknown } | null)?.payload))
      .catch(() => { void refreshState(key); });
  }, [applyState, refreshState, conversationIdRef]);

  const reorderPendingFollowUp = useCallback((fromIndex: number, toIndex: number) => {
    const key = conversationIdRef.current;
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
  }, [applyState, refreshState, conversationIdRef]);

  const steerPendingFollowUp = useCallback(async (id: string) => {
    const key = conversationIdRef.current;
    if (!key) return;
    const row = pendingFollowUpsRef.current.find((r) => r.id === id);
    if (!row?.text.trim() || row.attachments?.length || row.contextRefs?.length) return;
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
  }, [applyState, removePendingFollowUp, conversationIdRef]);

  const respondToClarification = useCallback(async (action: 'answer' | 'agent_decide' | 'cancel', answer?: string) => {
    const p = clarifyPromptRef.current;
    if (!p) return;
    const signature = `${p.requestId}\n${p.version}\n${action}\n${answer ?? ''}`;
    if (clarificationAttemptRef.current?.signature !== signature) {
      clarificationAttemptRef.current = { signature, idempotencyKey: crypto.randomUUID() };
    }
    const idempotencyKey = clarificationAttemptRef.current.idempotencyKey;
    setClarifySubmitting(true);
    setClarifySubmitError(null);
    try {
      const res = await apiFetch(apiUrl(`/api/clarifications/${encodeURIComponent(p.requestId)}/responses`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, answer, expectedVersion: p.version, idempotencyKey }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        setClarifySubmitError(j.error?.message ?? res.statusText ?? 'Clarify failed');
        const key = conversationIdRef.current;
        if (key && (res.status === 409 || res.status === 410)) void refreshClarification(key);
        return;
      }
      clarificationAttemptRef.current = null;
      setClarifyPrompt(null);
      setClarifySubmitError(null);
    } finally {
      setClarifySubmitting(false);
    }
  }, [refreshClarification, conversationIdRef]);

  const submitClarifyAnswer = useCallback(
    (answer: string) => respondToClarification('answer', answer),
    [respondToClarification],
  );
  const letAgentDecideClarification = useCallback(() => respondToClarification('agent_decide'), [respondToClarification]);
  const cancelClarification = useCallback(() => respondToClarification('cancel'), [respondToClarification]);

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
    letAgentDecideClarification,
    cancelClarification,
    clearVisibleClarify,
    dismissClarify,
    dismissClarifyForSession,
    clearPendingFollowUps,
    dismissClarifyAndClearPending,
    makeOnClarifyRequest,
  };
}
