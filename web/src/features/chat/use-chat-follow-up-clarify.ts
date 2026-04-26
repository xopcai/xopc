import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';

import type { ClarifyPromptState } from '@/features/chat/clarify-prompt';
import type { ProgressState } from '@/features/chat/messages.types';
import {
  suggestFollowUpsFromAssistantMessage,
  type FollowUpSuggestionId,
} from '@/features/chat/follow-up-suggestions';
import type { Message } from '@/features/chat/messages.types';
import { MAX_PENDING_FOLLOW_UPS, type PendingFollowUp } from '@/features/chat/pending-follow-up.types';
import { apiFetch } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

export type ChatFollowUpClarifyApi = {
  clarifyPrompt: ClarifyPromptState | null;
  clarifySubmitting: boolean;
  clarifyPromptRef: MutableRefObject<ClarifyPromptState | null>;
  pendingFollowUps: PendingFollowUp[];
  pendingFollowUpsRef: MutableRefObject<PendingFollowUp[]>;
  followUpSuggestions: FollowUpSuggestionId[];
  steeringFollowUpId: string | null;
  /** Row open in the composer for in-place edit (line stays in queue until commit). */
  editingFollowUpId: string | null;
  addPendingFollowUp: (
    content: string,
    attachments?: Array<{ type: string; mimeType?: string; data?: string; name?: string; size?: number }>,
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
  pickFollowUpSuggestion: (text: string) => void;
  submitClarifyAnswer: (answer: string) => Promise<void>;
  dismissClarify: () => void;
  clearPendingFollowUps: () => void;
  dismissClarifyAndClearPending: () => void;
  refreshFollowUpSuggestions: (appended: Message) => void;
  clearFollowUpSuggestions: () => void;
  onClarifyToolEnd: () => void;
  makeOnClarifyRequest: (chatId: string) => (payload: ClarifyPromptState) => void;
  /** Dequeue next pending follow-up and send it (used after assistant turn finalizes). */
  flushSteeringQueue: () => void;
};

export function useChatFollowUpClarify(options: {
  sessionKey: string | null;
  decodedKey: string | undefined;
  sessionKeyRef: MutableRefObject<string | null>;
  sendingRef: MutableRefObject<boolean>;
  streamingRef: MutableRefObject<boolean>;
  setSending: (v: boolean) => void;
  setStreaming: (v: boolean) => void;
  setProgress: Dispatch<SetStateAction<ProgressState | null>>;
  modelSupportsThinking: boolean;
  thinkingLevel: string;
  shouldApplyStreamUpdate: (streamSessionKey: string) => boolean;
  setError: (msg: string | null) => void;
  sendMessageRef: MutableRefObject<
    (content: string, attachments?: PendingFollowUp['attachments'], levelOverride?: string) => Promise<void>
  >;
}): ChatFollowUpClarifyApi {
  const {
    sessionKey,
    decodedKey,
    sessionKeyRef,
    sendingRef,
    streamingRef,
    setSending,
    setStreaming,
    setProgress,
    modelSupportsThinking,
    thinkingLevel,
    shouldApplyStreamUpdate,
    setError,
    sendMessageRef,
  } = options;

  const [clarifyPrompt, setClarifyPrompt] = useState<ClarifyPromptState | null>(null);
  const [clarifySubmitting, setClarifySubmitting] = useState(false);
  const clarifyPromptRef = useRef<ClarifyPromptState | null>(null);

  const [pendingFollowUps, setPendingFollowUps] = useState<PendingFollowUp[]>([]);
  const pendingFollowUpsRef = useRef<PendingFollowUp[]>([]);
  const [steeringFollowUpId, setSteeringFollowUpId] = useState<string | null>(null);
  const [editingFollowUpId, setEditingFollowUpId] = useState<string | null>(null);
  const editingFollowUpIdRef = useRef<string | null>(null);
  const [followUpSuggestions, setFollowUpSuggestions] = useState<FollowUpSuggestionId[]>([]);

  useEffect(() => {
    clarifyPromptRef.current = clarifyPrompt;
  }, [clarifyPrompt]);

  useEffect(() => {
    pendingFollowUpsRef.current = [];
    setPendingFollowUps([]);
    setFollowUpSuggestions([]);
    setEditingFollowUpId(null);
  }, [sessionKey]);

  useEffect(() => {
    pendingFollowUpsRef.current = pendingFollowUps;
  }, [pendingFollowUps]);

  useEffect(() => {
    editingFollowUpIdRef.current = editingFollowUpId;
  }, [editingFollowUpId]);

  useEffect(() => {
    if (!decodedKey) return;
    if (decodedKey !== sessionKeyRef.current) {
      setClarifyPrompt(null);
    }
  }, [decodedKey, sessionKeyRef]);

  const dismissClarify = useCallback(() => {
    setClarifyPrompt(null);
  }, []);

  const clearPendingFollowUps = useCallback(() => {
    pendingFollowUpsRef.current = [];
    setPendingFollowUps([]);
    setEditingFollowUpId(null);
  }, []);

  const dismissClarifyAndClearPending = useCallback(() => {
    pendingFollowUpsRef.current = [];
    setPendingFollowUps([]);
    setClarifyPrompt(null);
    setEditingFollowUpId(null);
  }, []);

  const clearFollowUpSuggestions = useCallback(() => {
    setFollowUpSuggestions([]);
  }, []);

  const refreshFollowUpSuggestions = useCallback((appended: Message) => {
    setFollowUpSuggestions(suggestFollowUpsFromAssistantMessage(appended));
  }, []);

  const onClarifyToolEnd = useCallback(() => {
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
      setClarifyPrompt(payload);
    },
    [shouldApplyStreamUpdate, sendingRef, streamingRef, setSending, setStreaming, setProgress],
  );

  const flushSteeringQueue = useCallback(() => {
    let q = pendingFollowUpsRef.current;
    while (q.length > 0 && !q[0].text.trim() && !q[0].attachments?.length) {
      q = q.slice(1);
    }
    if (q.length === 0) {
      pendingFollowUpsRef.current = [];
      setPendingFollowUps([]);
      return;
    }
    const [first, ...rest] = q;
    if (editingFollowUpIdRef.current === first.id) {
      setEditingFollowUpId(null);
    }
    pendingFollowUpsRef.current = rest;
    setPendingFollowUps(rest);
    void sendMessageRef.current(first.text, first.attachments, first.thinkingLevel);
  }, [sendMessageRef]);

  const addPendingFollowUp = useCallback(
    (
      content: string,
      attachments?: Array<{ type: string; mimeType?: string; data?: string; name?: string; size?: number }>,
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

  const pickFollowUpSuggestion = useCallback(
    (text: string) => {
      const t = text.trim();
      if (!t) return;
      setFollowUpSuggestions([]);
      if (sendingRef.current || streamingRef.current) {
        if (pendingFollowUpsRef.current.length >= MAX_PENDING_FOLLOW_UPS) {
          console.warn(
            `Follow-up queue is full (max ${MAX_PENDING_FOLLOW_UPS}). Remove one or wait for the run to finish.`,
          );
          return;
        }
        addPendingFollowUp(t, undefined);
        return;
      }
      void sendMessageRef.current(t, undefined, undefined);
    },
    [addPendingFollowUp, sendMessageRef, sendingRef, streamingRef],
  );

  const submitClarifyAnswer = useCallback(async (answer: string) => {
    const p = clarifyPromptRef.current;
    if (!p) return;
    setClarifySubmitting(true);
    try {
      const res = await apiFetch(apiUrl(`/api/clarify/${encodeURIComponent(p.requestId)}`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answer }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        setError(j.error?.message ?? res.statusText ?? 'Clarify failed');
      }
      setClarifyPrompt(null);
    } finally {
      setClarifySubmitting(false);
    }
  }, [setError]);

  return {
    clarifyPrompt,
    clarifySubmitting,
    clarifyPromptRef,
    pendingFollowUps,
    pendingFollowUpsRef,
    followUpSuggestions,
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
    pickFollowUpSuggestion,
    submitClarifyAnswer,
    dismissClarify,
    clearPendingFollowUps,
    dismissClarifyAndClearPending,
    refreshFollowUpSuggestions,
    clearFollowUpSuggestions,
    onClarifyToolEnd,
    makeOnClarifyRequest,
    flushSteeringQueue,
  };
}
