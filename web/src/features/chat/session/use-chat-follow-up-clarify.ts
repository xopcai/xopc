import {
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';

import type { ClarifyPromptState } from '@/features/chat/composer/clarify-prompt';
import {
  clearFollowUpQueueSnapshot,
  readFollowUpQueueSnapshot,
  writeFollowUpQueueSnapshot,
} from '@/features/chat/follow-up/follow-up-queue-storage';
import type { ProgressState } from '@/features/chat/messages/messages.types';
import {
  FOLLOW_UP_AUTO_SEND_IDLE_MS,
  MAX_PENDING_FOLLOW_UPS,
  type PendingFollowUp,
} from '@/features/chat/follow-up/pending-follow-up.types';
import { apiFetch } from '@/lib/fetch';
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
  ) => void;
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
  dismissClarify: () => void;
  clearPendingFollowUps: () => void;
  dismissClarifyAndClearPending: () => void;
  onClarifyToolEnd: () => void;
  makeOnClarifyRequest: (chatId: string) => (payload: ClarifyPromptState) => void;
  /**
   * Dequeue next pending follow-up and send it (awaits POST+SSE; used after assistant turn finalizes).
   * When `forChatId` is set, no-op if the user navigated away (avoids dequeuing the wrong session's ref).
   */
  flushSteeringQueue: (forChatId?: string | null) => Promise<void>;
};

export function useChatFollowUpClarify(options: {
  sessionKey: string | null;
  decodedKey: string | undefined;
  sessionKeyRef: MutableRefObject<string | null>;
  /** Same ref as `sendMessage` guard — must match before dequeuing a follow-up. */
  activeStreamSessionKeyRef: MutableRefObject<string | null>;
  sendingRef: MutableRefObject<boolean>;
  streamingRef: MutableRefObject<boolean>;
  setSending: (v: boolean) => void;
  setStreaming: (v: boolean) => void;
  setProgress: Dispatch<SetStateAction<ProgressState | null>>;
  modelSupportsThinking: boolean;
  thinkingLevel: string;
  shouldApplyStreamUpdate: (streamSessionKey: string) => boolean;
  sendMessageRef: MutableRefObject<
    (content: string, attachments?: PendingFollowUp['attachments'], levelOverride?: string) => Promise<void>
  >;
}): ChatFollowUpClarifyApi {
  const {
    sessionKey,
    decodedKey,
    sessionKeyRef,
    activeStreamSessionKeyRef,
    sendingRef,
    streamingRef,
    setSending,
    setStreaming,
    setProgress,
    modelSupportsThinking,
    thinkingLevel,
    shouldApplyStreamUpdate,
    sendMessageRef,
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
  const [hydratedQueueKey, setHydratedQueueKey] = useState<string | null>(null);

  /** Last `#/chat/:id` segment (decoded); drives flush-save on sidebar navigation before `sessionKey` catches up. */
  const followUpPrevDecodedKeyRef = useRef<string | undefined>(undefined);
  /** Last `sessionKey` from loaded session; flush-save when it changes so debounce cancellation cannot drop data. */
  const followUpPrevLoadedSessionRef = useRef<string | null>(null);

  clarifyPromptRef.current = clarifyPrompt;
  pendingFollowUpsRef.current = pendingFollowUps;
  editingFollowUpIdRef.current = editingFollowUpId;

  const syncQueueKey =
    sessionKey && decodedKey && sessionKey === decodedKey ? sessionKey : null;

  const prevDecodedRoute = followUpPrevDecodedKeyRef.current;
  if (prevDecodedRoute != null && prevDecodedRoute !== decodedKey) {
    writeFollowUpQueueSnapshot(prevDecodedRoute, {
      pending: structuredClone(pendingFollowUps),
      editingId: editingFollowUpId,
    });
    if (steeringFollowUpId !== null) {
      setSteeringFollowUpId(null);
    }
  }
  followUpPrevDecodedKeyRef.current = decodedKey;

  const prevLoadedSession = followUpPrevLoadedSessionRef.current;
  if (prevLoadedSession != null && prevLoadedSession !== sessionKey) {
    writeFollowUpQueueSnapshot(prevLoadedSession, {
      pending: structuredClone(pendingFollowUps),
      editingId: editingFollowUpId,
    });
  }
  followUpPrevLoadedSessionRef.current = sessionKey;

  if (!sessionKey && !decodedKey) {
    if (pendingFollowUps.length > 0 || editingFollowUpId !== null || hydratedQueueKey !== null) {
      pendingFollowUpsRef.current = [];
      setPendingFollowUps([]);
      setEditingFollowUpId(null);
      setHydratedQueueKey(null);
    }
  } else if (syncQueueKey != null && syncQueueKey !== hydratedQueueKey) {
    const snap = readFollowUpQueueSnapshot(syncQueueKey);
    const pending = snap ? structuredClone(snap.pending) : [];
    pendingFollowUpsRef.current = pending;
    setPendingFollowUps(pending);
    setEditingFollowUpId(snap?.editingId ?? null);
    setHydratedQueueKey(syncQueueKey);
  }

  if (sessionKey != null && sessionKey !== decodedKey && clarifyPrompt != null) {
    setClarifyPrompt(null);
  }

  /**
   * Debounced persist. While `sessionRoutePending`, the in-memory queue still belongs to
   * `sessionKey` (loaded), not `decodedKey` (URL) — write under `sessionKey` so we do not clobber the target chat.
   */
  useEffect(() => {
    const diskKey =
      sessionKey != null && decodedKey != null && sessionKey !== decodedKey
        ? sessionKey
        : (sessionKey ?? decodedKey ?? null);
    if (!diskKey) return;
    const t = window.setTimeout(() => {
      if (sessionKeyRef.current !== diskKey) return;
      writeFollowUpQueueSnapshot(diskKey, {
        pending: structuredClone(pendingFollowUpsRef.current),
        editingId: editingFollowUpIdRef.current,
      });
    }, 280);
    return () => window.clearTimeout(t);
  }, [sessionKey, decodedKey, pendingFollowUps, editingFollowUpId, sessionKeyRef]);

  const dismissClarify = useCallback(() => {
    setClarifySubmitError(null);
    setClarifyPrompt(null);
  }, []);

  const clearPendingFollowUps = useCallback(() => {
    const key = sessionKeyRef.current;
    if (key) clearFollowUpQueueSnapshot(key);
    pendingFollowUpsRef.current = [];
    setPendingFollowUps([]);
    setEditingFollowUpId(null);
    setHydratedQueueKey(key);
  }, [sessionKeyRef]);

  const dismissClarifyAndClearPending = useCallback(() => {
    const key = sessionKeyRef.current;
    if (key) clearFollowUpQueueSnapshot(key);
    pendingFollowUpsRef.current = [];
    setPendingFollowUps([]);
    setClarifySubmitError(null);
    setClarifyPrompt(null);
    setEditingFollowUpId(null);
    setHydratedQueueKey(key);
  }, [sessionKeyRef]);

  const onClarifyToolEnd = useCallback(() => {
    setClarifySubmitError(null);
    setClarifyPrompt(null);
  }, []);

  const makeOnClarifyRequest = useCallback(
    (chatId: string) => (payload: ClarifyPromptState) => {
      if (!shouldApplyStreamUpdate(chatId)) return;
      sendingRef.current = false;
      streamingRef.current = false;
      setSending(false);
      setStreaming(false);
      setProgress(null);
      setClarifySubmitError(null);
      setClarifyPrompt(payload);
    },
    [shouldApplyStreamUpdate, sendingRef, streamingRef, setSending, setStreaming, setProgress],
  );

  const flushSteeringQueue = useCallback(async (forChatId?: string | null) => {
    const routeSk = sessionKeyRef.current;
    if (forChatId != null && forChatId !== routeSk) {
      return;
    }
    const sk = routeSk;
    if (!sk) return;

    let q = pendingFollowUpsRef.current;
    while (q.length > 0 && !q[0].text.trim() && !q[0].attachments?.length) {
      q = q.slice(1);
    }
    if (q.length === 0) {
      pendingFollowUpsRef.current = [];
      setPendingFollowUps([]);
      return;
    }
    if (q.length !== pendingFollowUpsRef.current.length) {
      pendingFollowUpsRef.current = q;
      setPendingFollowUps(q);
    }

    const [first, ...rest] = q;
    const trimmed = first.text?.trim() ?? '';
    const atts = first.attachments;
    if (!trimmed && !atts?.length) return;

    // Mirror `sendMessage` early return — never dequeue if send would no-op (drops otherwise).
    if (
      activeStreamSessionKeyRef.current === sk &&
      (sendingRef.current || streamingRef.current)
    ) {
      return;
    }

    if (editingFollowUpIdRef.current === first.id) {
      setEditingFollowUpId(null);
    }
    pendingFollowUpsRef.current = rest;
    setPendingFollowUps(rest);
    await sendMessageRef.current(first.text, first.attachments, first.thinkingLevel);
  }, [sendMessageRef, sessionKeyRef, activeStreamSessionKeyRef, sendingRef, streamingRef]);

  const flushSteeringQueueEvent = useEffectEvent((forChatId?: string | null) => {
    void flushSteeringQueue(forChatId);
  });

  /**
   * After hydration or returning to a chat, resume the auto-send chain if the queue has rows and the
   * session is idle (covers skipped `finalizeMessage` timeouts when switching chats mid-delay).
   */
  useEffect(() => {
    if (!sessionKey || sessionKey !== decodedKey) return;
    if (clarifyPrompt) return;
    if (pendingFollowUps.length === 0) return;
    if (sendingRef.current || streamingRef.current) return;
    const first = pendingFollowUps[0];
    if (!first || (!first.text.trim() && !first.attachments?.length)) return;

    const tid = window.setTimeout(() => {
      if (sessionKeyRef.current !== sessionKey) return;
      if (sendingRef.current || streamingRef.current) return;
      if (clarifyPromptRef.current) return;
      flushSteeringQueueEvent(sessionKey);
    }, FOLLOW_UP_AUTO_SEND_IDLE_MS);
    return () => window.clearTimeout(tid);
  }, [sessionKey, decodedKey, clarifyPrompt, pendingFollowUps, sendingRef, streamingRef, sessionKeyRef]);

  const addPendingFollowUp = useCallback(
    (
      content: string,
      attachments?: PendingFollowUp['attachments'],
    ) => {
      const trimmed = content.trim();
      if (!trimmed && !attachments?.length) return;
      if (pendingFollowUpsRef.current.length >= MAX_PENDING_FOLLOW_UPS) {
        return;
      }
      const effectiveThinking = modelSupportsThinking ? thinkingLevel : 'off';
      const row: PendingFollowUp = {
        id: crypto.randomUUID(),
        text: trimmed || content,
        attachments: attachments?.length ? attachments : undefined,
        thinkingLevel: effectiveThinking,
      };
      setPendingFollowUps((prev) => {
        const next = [...prev, row];
        pendingFollowUpsRef.current = next;
        return next;
      });
    },
    [modelSupportsThinking, thinkingLevel],
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
        const next = prev.filter((r) => r.id !== id);
        pendingFollowUpsRef.current = next;
        setPendingFollowUps(next);
        setEditingFollowUpId(null);
        return;
      }
      const next = [...prev];
      const effThinking = modelSupportsThinking ? (levelOverride ?? thinkingLevel) : 'off';
      next[i] = {
        ...next[i],
        text: trimmed || content,
        attachments: attachments?.length ? attachments : undefined,
        thinkingLevel: effThinking,
      };
      pendingFollowUpsRef.current = next;
      setPendingFollowUps(next);
      setEditingFollowUpId(null);
    },
    [modelSupportsThinking, thinkingLevel],
  );

  const removePendingFollowUp = useCallback((id: string) => {
    if (editingFollowUpIdRef.current === id) {
      setEditingFollowUpId(null);
    }
    setPendingFollowUps((prev) => {
      const next = prev.filter((r) => r.id !== id);
      pendingFollowUpsRef.current = next;
      return next;
    });
  }, []);

  const movePendingFollowUp = useCallback((id: string, dir: 'up' | 'down') => {
    setPendingFollowUps((prev) => {
      const i = prev.findIndex((r) => r.id === id);
      if (i < 0) return prev;
      const j = dir === 'up' ? i - 1 : i + 1;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      pendingFollowUpsRef.current = next;
      return next;
    });
  }, []);

  const reorderPendingFollowUp = useCallback((fromIndex: number, toIndex: number) => {
    setPendingFollowUps((prev) => {
      if (fromIndex < 0 || fromIndex >= prev.length || toIndex < 0 || toIndex >= prev.length) {
        return prev;
      }
      const next = [...prev];
      const [removed] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, removed);
      pendingFollowUpsRef.current = next;
      return next;
    });
  }, []);

  const steerPendingFollowUp = useCallback(async (id: string) => {
    const key = sessionKeyRef.current;
    if (!key) return;
    const row = pendingFollowUpsRef.current.find((r) => r.id === id);
    if (!row?.text.trim() || row.attachments?.length) return;
    setSteeringFollowUpId(id);
    try {
      const res = await apiFetch(apiUrl('/api/agent/steer'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId: key, message: row.text.trim() }),
      });
      if (res.ok) {
        setPendingFollowUps((prev) => {
          const next = prev.filter((r) => r.id !== id);
          pendingFollowUpsRef.current = next;
          return next;
        });
        if (editingFollowUpIdRef.current === id) {
          setEditingFollowUpId(null);
        }
      }
    } catch {
      /* ignore */
    } finally {
      setSteeringFollowUpId(null);
    }
  }, [sessionKeyRef]);

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
      setClarifyPrompt(null);
      setClarifySubmitError(null);
    } finally {
      setClarifySubmitting(false);
    }
  }, []);

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
      setClarifyPrompt(null);
      setClarifySubmitError(null);
    } finally {
      setClarifySubmitting(false);
    }
  }, []);

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
    dismissClarify,
    clearPendingFollowUps,
    dismissClarifyAndClearPending,
    onClarifyToolEnd,
    makeOnClarifyRequest,
    flushSteeringQueue,
  };
}
