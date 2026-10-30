import { useGatewayStore } from '@/stores/gateway-store';
import type { SessionInputControlView, SessionInputControlCommand } from '@xopcai/gateway-contract';
import type { ComposerDraft, ComposerMode } from '@/features/chat/composer/composer.types';
import { readInputControl, rememberInputControl, requestInputControl } from './session-input-control';
import { submitQuestionBatch } from '../clarification/clarification-submission';
import type { ClarificationSubmission } from '@xopcai/gateway-contract';
import { readClarificationPresentation } from '@xopcai/gateway-contract';
import type { AppContextEnvelope } from '@xopcai/gateway-contract';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MutableRefObject,
} from 'react';

import { showComposerNotification } from '@/features/chat/composer/composer-notifications';
import type { ClarifyPromptState } from '@/features/chat/composer/clarify-prompt';
import type { ComposerContextRef } from '@/features/chat/composer/composer.types';
import { useChatSessionStore } from '@/features/chat/session/chat-session-store';
import {
  projectVisiblePendingFollowUps,
  type PendingFollowUp,
} from '@/features/chat/follow-up/pending-follow-up.types';
import { apiFetch } from '@/lib/fetch';
import { waitForEndpointTurnClaim } from '@/features/endpoint-tools/turn-claim';
import { apiUrl } from '@/lib/url';

import { submitQueuedInput } from './submit-queued-input';
import { readLocalSessionDraft, readSessionTranscript } from './local-session-drafts';

export type ChatFollowUpClarifyApi = {
  composerMode: ComposerMode;
  control: SessionInputControlView;
  controlPending: boolean;
  stopSession: () => Promise<void>;
  resumeQueue: () => Promise<void>;
  sendQueuedInput: (id: string) => Promise<void>;
  beginEditTurn: (turnId: string, draft?: ComposerDraft) => Promise<boolean>;
  cancelEditor: () => void;
  restoreEditor: (mode: ComposerMode) => void;
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
    appContext?: AppContextEnvelope,
    interrupt?: boolean,
  ) => Promise<void>;
  beginEditFollowUp: (id: string) => Promise<boolean>;
  cancelEditFollowUp: () => void;
  commitEditFollowUp: (
    id: string,
    content: string,
    attachments?: PendingFollowUp['attachments'],
    levelOverride?: string,
    contextRefs?: ComposerContextRef[],
  ) => Promise<boolean>;
  removePendingFollowUp: (id: string) => void;
  movePendingFollowUp: (id: string, dir: 'up' | 'down') => void;
  reorderPendingFollowUp: (fromIndex: number, toIndex: number) => void;
  steerPendingFollowUp: (id: string) => Promise<void>;
  submitClarifyAnswer: (submission: ClarificationSubmission) => Promise<void>;
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

  if (typeof requestId !== 'string' || !requestId.trim() || typeof question !== 'string' || !question.trim()) return null;
  return {
    ...readClarificationPresentation(value),
    requestId: requestId.trim(),
    conversationId: expectedConversationId,
    kind,
    question: question.trim(),


    version: typeof value.version === 'number' ? value.version : 1,
    createdAt: typeof value.createdAt === 'number' ? value.createdAt : Date.now(),
    expiresAt: typeof value.expiresAt === 'number' ? value.expiresAt : undefined,
    serverTime: typeof record.serverTime === 'number' ? record.serverTime : undefined,
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

  const gatewayIdentity = useGatewayStore(state => state.conversationId);
  const scopeRef = useRef({ gateway: gatewayIdentity, conversationId });
  if (scopeRef.current.gateway !== gatewayIdentity || scopeRef.current.conversationId !== conversationId) {
    scopeRef.current = { gateway: gatewayIdentity, conversationId };
  }
  const captureScope = useCallback(() => {
    const scope = scopeRef.current;
    return () => scopeRef.current === scope && conversationIdRef.current === scope.conversationId
      && useGatewayStore.getState().conversationId === scope.gateway;
  }, [conversationIdRef]);

  const [clarifyPrompt, setClarifyPrompt] = useState<ClarifyPromptState | null>(null);
  const [clarifySubmitting, setClarifySubmitting] = useState(false);
  const [clarifySubmitError, setClarifySubmitError] = useState<string | null>(null);
  const clarifyPromptRef = useRef<ClarifyPromptState | null>(null);
  const clarificationRefreshRef = useRef(0);
  const clarificationAttemptRef = useRef<{ signature: string; idempotencyKey: string } | null>(null);

  const [pendingFollowUps, setPendingFollowUps] = useState<PendingFollowUp[]>([]);
  const pendingFollowUpsRef = useRef<PendingFollowUp[]>([]);
  const [steeringFollowUpId, setSteeringFollowUpId] = useState<string | null>(null);
  const [editorState, setEditorState] = useState<{ scope: typeof scopeRef.current; mode: ComposerMode }>(() => ({ scope: scopeRef.current, mode: { kind: 'compose' } }));
  const composerMode: ComposerMode = editorState.scope === scopeRef.current ? editorState.mode : { kind: 'compose' };
  const setComposerMode = useCallback((mode: ComposerMode) => setEditorState({ scope: scopeRef.current, mode }), []);
  const composerModeRef = useRef(composerMode);
  composerModeRef.current = composerMode;
  const editingFollowUpId = composerMode.kind === 'editFollowUp' ? composerMode.inputId : null;
  const setEditingFollowUpId = (id: string | null) => setComposerMode(id
    ? { kind: 'editFollowUp', inputId: id, version: pendingFollowUpsRef.current.find(row => row.id === id)?.version ?? 0 }
    : { kind: 'compose' });
  const [control, setControl] = useState<SessionInputControlView>(() => readInputControl(conversationId ?? ''));
  const [controlPending, setControlPending] = useState(false);
  const controlPendingRef = useRef(false);
  const editingFollowUpIdRef = useRef<string | null>(null);
  const revisionRef = useRef(-1);

  clarifyPromptRef.current = clarifyPrompt;
  pendingFollowUpsRef.current = pendingFollowUps;
  editingFollowUpIdRef.current = editingFollowUpId;

  const applyState = useCallback((raw: unknown) => {
    if (!raw || typeof raw !== 'object') return;
    const state = raw as { conversationId?: unknown; revision?: unknown; activeRunId?: unknown; preparation?: { state?: unknown }; control?: SessionInputControlView; inputs?: unknown };
    if (state.conversationId !== conversationIdRef.current || typeof state.revision !== 'number' || !Array.isArray(state.inputs)) return;
    if (state.revision < revisionRef.current) return;
    if (state.control) {
      if (!rememberInputControl(state.conversationId as string, state.control, state.revision)) return;
      setControl(state.control);
    }
    const rows = projectVisiblePendingFollowUps({
      control: state.control,
      inputs: state.inputs as unknown[],
      activeRunId: state.activeRunId,
      preparation: state.preparation,
    });
    revisionRef.current = state.revision;
    pendingFollowUpsRef.current = rows;
    setPendingFollowUps(rows);

  }, [conversationIdRef]);

  const refreshState = useCallback(async (key: string) => {
    if (key !== conversationIdRef.current) return;
    const isCurrentScope = captureScope();
    if (await readLocalSessionDraft(key) || !isCurrentScope()) return;
    const res = await apiFetch(apiUrl(`/api/sessions/${encodeURIComponent(key)}/input-state`)).catch(() => null);
    if (!res?.ok || conversationIdRef.current !== key) return;
    const json = await res.json().catch(() => null) as { payload?: unknown } | null;
    if (isCurrentScope()) applyState(json?.payload);
  }, [applyState, captureScope, conversationIdRef]);

  const refreshClarification = useCallback(async (key: string) => {
    if (key !== conversationIdRef.current) return;
    const isCurrentScope = captureScope();
    const generation = ++clarificationRefreshRef.current;
    if (await readLocalSessionDraft(key) || !isCurrentScope()) return;
    const res = await apiFetch(apiUrl(`/api/sessions/${encodeURIComponent(key)}/clarification`)).catch(() => null);
    if (!res?.ok || conversationIdRef.current !== key) return;
    const json = await res.json().catch(() => null) as { payload?: unknown } | null;
    if (!isCurrentScope() || generation !== clarificationRefreshRef.current || conversationIdRef.current !== key) return;
    setClarifySubmitError(null);
    setClarifyPrompt(parseClarification(json?.payload, key));
    clarificationAttemptRef.current = null;
  }, [captureScope, conversationIdRef]);

  useLayoutEffect(() => {
    revisionRef.current = -1;
    controlPendingRef.current = false;
    setControlPending(false);
    setSteeringFollowUpId(null);
    clarificationRefreshRef.current++;
    setControl(readInputControl(conversationId ?? ''));
    setComposerMode({ kind: 'compose' });
    pendingFollowUpsRef.current = [];
    setPendingFollowUps([]);
    setEditingFollowUpId(null);
    setClarifyPrompt(null);
  }, [conversationId, gatewayIdentity]);

  useEffect(() => {
    if (!conversationId || conversationId !== decodedKey) return;
    void refreshState(conversationId);
    void refreshClarification(conversationId);
  }, [decodedKey, refreshClarification, refreshState, conversationId, gatewayIdentity]);

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
      clarificationRefreshRef.current++;
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
      clarificationRefreshRef.current++;
      setClarifyPrompt({ ...payload, conversationId: chatId });
      clarificationAttemptRef.current = null;
    },
    [shouldApplyStreamUpdate, sendingRef, streamingRef],
  );

  const addPendingFollowUp = useCallback(
    async (
      content: string,
      attachments?: PendingFollowUp['attachments'],
      contextRefs?: ComposerContextRef[],
      appContext?: AppContextEnvelope,
      interrupt?: boolean,
    ) => {
      const trimmed = content.trim();
      if (!trimmed && !attachments?.length && !contextRefs?.length) return;
      const key = conversationIdRef.current;
      if (!key) throw new Error('No active session');
      const isCurrentScope = captureScope();
      const controlAtSubmit = readInputControl(key);
      const expectedTranscriptId = await readSessionTranscript(key);
      if (!isCurrentScope()) throw new DOMException('Conversation changed', 'AbortError');
      const origin = await waitForEndpointTurnClaim();
      if (!isCurrentScope()) throw new DOMException('Conversation changed', 'AbortError');
      if (!expectedTranscriptId) throw new Error('Reload the conversation before sending');
      const configVersion = useChatSessionStore.getState().sessions[key]?.configVersion;
      if (configVersion === undefined) throw new Error('Reload the conversation before sending');
      const state = await submitQueuedInput(key, {
        kind: 'append', expectedTranscriptId, configVersion,
        clientMessageId: crypto.randomUUID(), delivery: 'next', interrupt,
        controlVersion: controlAtSubmit.version,
        input: { content: trimmed || content, attachments: attachments?.length ? attachments : undefined,
          contextRefs: contextRefs?.map(({ refId, kind, sourceId, expectedVersion }) => ({ refId, kind, sourceId, expectedVersion })),
          appContext },
        origin,
      }, isCurrentScope);
      if (isCurrentScope()) applyState(state);
    },
    [applyState, captureScope, conversationIdRef],
  );

  const changeControl = useCallback(async (action: SessionInputControlCommand['action'], target?: { inputId?: string; inputVersion?: number; turnId?: string }) => {
    const key = conversationIdRef.current;
    if (!key || controlPendingRef.current) throw new Error('Wait for the current operation');
    const isCurrentScope = captureScope();
    const assertScope = () => { if (!isCurrentScope()) throw new DOMException('Conversation changed', 'AbortError'); };
    controlPendingRef.current = true;
    setControlPending(true);
    try {
      let transcriptId = await readSessionTranscript(key);
      assertScope();
      const confirmationDeadline = Date.now() + 15_000;
      while (!transcriptId && action === 'stop' && Date.now() < confirmationDeadline) {
        await new Promise(resolve => setTimeout(resolve, 100));
        transcriptId = await readSessionTranscript(key);
        assertScope();
      }
      if (!transcriptId) throw new Error('Input acceptance is awaiting confirmation');
      const command = { action, operationId: crypto.randomUUID(), expectedTranscriptId: transcriptId,
        expectedVersion: readInputControl(key).version, ...target };
      const result = await requestInputControl(key, command);
      assertScope();
      applyState(result);
      if (action === 'stop') {
        const deadline = Date.now() + 15_000;
        while (readInputControl(key).phase === 'stopping') {
          assertScope();
          if (Date.now() >= deadline) throw new Error('Stop is awaiting confirmation');
          await new Promise(resolve => setTimeout(resolve, 100));
          await refreshState(key);
        }
      }
      assertScope();
      if (action === 'stop' || action === 'pause') {
        const current = readInputControl(key);
        if (!current.paused || current.version !== command.expectedVersion + 1) throw new Error('Queue control changed on another device');
        if (action === 'stop' && current.phase !== 'idle') throw new Error('Another input has started');
      }
    } catch (error) {
      if (!isCurrentScope()) throw error;
      await refreshState(key);
      if (!isCurrentScope()) throw error;
      showComposerNotification('error', error instanceof Error ? error.message : String(error));
      throw error;
    } finally {
      if (isCurrentScope()) { controlPendingRef.current = false; setControlPending(false); }
    }
  }, [applyState, captureScope, conversationIdRef, refreshState]);

  const stopSession = useCallback(() => changeControl('stop'), [changeControl]);
  const resumeQueue = useCallback(() => changeControl('resume'), [changeControl]);
  const beginEditTurn = useCallback(async (turnId: string, draft?: ComposerDraft) => {
    const isCurrentScope = captureScope();
    try {
      await changeControl('stop', { turnId });
      if (!isCurrentScope()) return false;
      setComposerMode({ kind: 'editTurn', turnId, draft });
      return true;
    } catch { return false; }
  }, [captureScope, changeControl]);
  const beginEditFollowUp = useCallback(async (id: string) => {
    const row = pendingFollowUpsRef.current.find(item => item.id === id);
    if (!row) return false;
    const isCurrentScope = captureScope();
    try {
      await changeControl('pause', { inputId: id, inputVersion: row.version });
      if (!isCurrentScope()) return false;
      setComposerMode({ kind: 'editFollowUp', inputId: id, version: row.version });
      return true;
    } catch { return false; }
  }, [captureScope, changeControl]);
  const cancelEditFollowUp = useCallback(() => setComposerMode({ kind: 'compose' }), []);
  const commitEditFollowUp = useCallback(async (id: string, content: string,
    attachments?: PendingFollowUp['attachments'], levelOverride?: string, contextRefs?: ComposerContextRef[]) => {
    const key = conversationIdRef.current;
    if (!key || composerMode.kind !== 'editFollowUp' || composerMode.inputId !== id) return false;
    if (!content.trim() && !attachments?.length && !contextRefs?.length) return false;
    const isCurrentScope = captureScope();
    const res = await apiFetch(apiUrl(`/api/sessions/${encodeURIComponent(key)}/inputs/${encodeURIComponent(id)}`), {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: composerMode.version, content,
        attachments: attachments ?? [], thinking: modelSupportsThinking ? (levelOverride ?? thinkingLevel) : 'off',
        contextRefs: (contextRefs ?? []).map(({ refId, kind, sourceId, expectedVersion }) => ({ refId, kind, sourceId, expectedVersion })),
      }),
    });
    const json = await res.json() as { payload?: unknown; error?: { message?: string } };
    if (!isCurrentScope()) return false;
    applyState(json.payload);
    if (!res.ok) throw new Error(json.error?.message ?? 'This input changed; your draft has been preserved');
    if (composerModeRef.current === composerMode) {
      const savedState = json.payload as { inputs?: Array<{ id: string; version: number }> } | undefined;
      const savedRow = savedState?.inputs?.find(row => row.id === id);
      if (savedRow) setComposerMode({ ...composerMode, version: savedRow.version });
    }
    return true;
  }, [applyState, captureScope, composerMode, conversationIdRef, modelSupportsThinking, thinkingLevel]);

  const removePendingFollowUp = useCallback((id: string) => {
    if (editingFollowUpIdRef.current === id) {
      setEditingFollowUpId(null);
    }
    const key = conversationIdRef.current;
    const row = pendingFollowUpsRef.current.find((item) => item.id === id);
    if (!key || !row) return;
    const isCurrentScope = captureScope();
    void apiFetch(apiUrl(`/api/sessions/${encodeURIComponent(key)}/inputs/${encodeURIComponent(id)}?version=${row.version}`), {
      method: 'DELETE',
    }).then(async (res) => {
      const json = await res.json().catch(() => null) as { payload?: unknown } | null;
      if (isCurrentScope()) applyState(json?.payload);
    }).catch(() => { void refreshState(key); });
  }, [applyState, captureScope, refreshState, conversationIdRef]);

  const movePendingFollowUp = useCallback((id: string, dir: 'up' | 'down') => {
    const queued = pendingFollowUpsRef.current.filter((row) => row.status === 'queued');
    const i = queued.findIndex((row) => row.id === id);
    if (i < 0) return;
    const target = dir === 'up' ? i - 1 : i + 1;
    const key = conversationIdRef.current;
    const row = queued[i];
    if (!key || !row || target < 0 || target >= queued.length) return;
    const isCurrentScope = captureScope();
    void apiFetch(apiUrl(`/api/sessions/${encodeURIComponent(key)}/inputs/${encodeURIComponent(row.id)}`), {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: row.version, position: target }),
    }).then(async res => {
      const json = await res.json().catch(() => null) as { payload?: unknown } | null;
      if (isCurrentScope()) applyState(json?.payload);
    })
      .catch(() => { void refreshState(key); });
  }, [applyState, captureScope, refreshState, conversationIdRef]);

  const reorderPendingFollowUp = useCallback((fromIndex: number, toIndex: number) => {
    const key = conversationIdRef.current;
    const row = pendingFollowUpsRef.current[fromIndex];
    const targetRow = pendingFollowUpsRef.current[toIndex];
    const queued = pendingFollowUpsRef.current.filter((item) => item.status === 'queued');
    const position = targetRow ? queued.findIndex((item) => item.id === targetRow.id) : -1;
    if (!key || row?.status !== 'queued' || targetRow?.status !== 'queued' || position < 0) return;
    const isCurrentScope = captureScope();
    void apiFetch(apiUrl(`/api/sessions/${encodeURIComponent(key)}/inputs/${encodeURIComponent(row.id)}`), {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: row.version, position }),
    }).then(async (res) => {
      const json = await res.json().catch(() => null) as { payload?: unknown } | null;
      if (isCurrentScope()) applyState(json?.payload);
    }).catch(() => { void refreshState(key); });
  }, [applyState, captureScope, refreshState, conversationIdRef]);

  const controlQueuedInput = useCallback(async (id: string, action: 'send' | 'steer') => {
    const row = pendingFollowUpsRef.current.find(item => item.id === id);
    if (!row) return;
    const isCurrentScope = captureScope();
    setSteeringFollowUpId(id);
    try { await changeControl(action, { inputId: id, inputVersion: row.version }); }
    finally { if (isCurrentScope()) setSteeringFollowUpId(null); }
  }, [captureScope, changeControl]);
  const steerPendingFollowUp = useCallback((id: string) => controlQueuedInput(id, 'steer'), [controlQueuedInput]);
  const sendQueuedInput = useCallback((id: string) => controlQueuedInput(id, 'send'), [controlQueuedInput]);

  const respondToClarification = useCallback(async (action: 'answer' | 'agent_decide' | 'cancel', submission?: ClarificationSubmission) => {
    const p = clarifyPromptRef.current;
    if (!p) return;
    const signature = JSON.stringify([p.requestId, p.version, action, submission]);
    if (clarificationAttemptRef.current?.signature !== signature) {
      clarificationAttemptRef.current = { signature, idempotencyKey: crypto.randomUUID() };
    }
    const idempotencyKey = clarificationAttemptRef.current.idempotencyKey;
    setClarifySubmitting(true);
    setClarifySubmitError(null);
    try {
      const res = p.schemaVersion === 2
        ? await submitQuestionBatch(p.requestId, p.version, action, submission, conversationIdRef.current ?? undefined)
        : await apiFetch(apiUrl(`/api/clarifications/${encodeURIComponent(p.requestId)}/responses`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...submission, expectedVersion: p.version, idempotencyKey }),
      });
      if (clarifyPromptRef.current?.requestId !== p.requestId) return;
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
    } catch (error) {
      if (clarifyPromptRef.current?.requestId === p.requestId) setClarifySubmitError(error instanceof Error ? error.message : String(error));
    } finally {
      setClarifySubmitting(false);
    }
  }, [refreshClarification, conversationIdRef]);

  const submitClarifyAnswer = useCallback(
    (submission: ClarificationSubmission) => respondToClarification('answer', submission),
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
    composerMode, control, controlPending, stopSession, resumeQueue, sendQueuedInput, beginEditTurn, cancelEditor: cancelEditFollowUp, restoreEditor: setComposerMode,
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
