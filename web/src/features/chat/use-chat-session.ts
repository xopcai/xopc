import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import useSWR from 'swr';

import {
  coerceReasoningLevel,
  type Message,
  type ProgressState,
  type ReasoningLevel,
} from '@/features/chat/messages.types';
import type { SessionInfo } from '@/features/chat/chat.types';
import { modelSupportsReasoning } from '@/features/chat/model-capabilities';
import { pendingAgentRunStorageKey, MessageSender } from '@/features/chat/message-sender';
import { fetchChatAgents } from '@/features/chat/chat-agents-api';
import { SessionManager, isWebUiSessionKey } from '@/features/chat/session-manager';
import { getAgentIdFromWebSessionKey } from '@/lib/web-session-agent';
import { mergeConsecutiveAssistantMessages } from '@/features/chat/agent-messages';
import {
  appendThinkingDelta,
  appendTextDelta,
  appendToolStart,
  cloneMessageForRender,
  completeTool,
  ensureAssistantMessage,
  finalizeRunningTools,
  finalizeStreamingThinking,
  hasRenderableAssistantContent,
  startThinkingSegment,
} from '@/features/chat/streaming';
import { useGatewayStore } from '@/stores/gateway-store';
import { apiFetch } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import type { ClarifyPromptState } from '@/features/chat/clarify-prompt';
import {
  suggestFollowUpsFromAssistantMessage,
  type FollowUpSuggestionId,
} from '@/features/chat/follow-up-suggestions';
import { MAX_PENDING_FOLLOW_UPS, type PendingFollowUp } from '@/features/chat/pending-follow-up.types';

const DEFAULT_THINKING = 'medium';
const DEFAULT_REASONING: ReasoningLevel = 'off';

const WEBCHAT_AGENT_STORAGE_KEY = 'xopc.webchat.agentId';

function readStoredWebchatAgentId(): string | null {
  if (typeof globalThis.localStorage === 'undefined') return null;
  try {
    const v = globalThis.localStorage.getItem(WEBCHAT_AGENT_STORAGE_KEY)?.trim().toLowerCase();
    return v || null;
  } catch {
    return null;
  }
}

function pickEmptyWebSessionForAgent(
  sessions: SessionInfo[],
  agentId: string | undefined,
): SessionInfo | undefined {
  if (!agentId) return undefined;
  return sessions.find(
    (s) =>
      isWebUiSessionKey(s.key) &&
      (s.messageCount ?? 0) === 0 &&
      getAgentIdFromWebSessionKey(s.key) === agentId,
  );
}

export function useChatSession() {
  const navigate = useNavigate();
  const location = useLocation();
  const { sessionKey: sessionKeyParam } = useParams();
  const token = useGatewayStore((s) => s.token);

  const { data: chatAgentsData, mutate: mutateChatAgents } = useSWR(
    token ? ['gateway-chat-agents', token] : null,
    fetchChatAgents,
    { revalidateOnFocus: false },
  );

  useEffect(() => {
    const onConfigReload = () => void mutateChatAgents();
    window.addEventListener('config-reload', onConfigReload as EventListener);
    return () => window.removeEventListener('config-reload', onConfigReload as EventListener);
  }, [mutateChatAgents]);

  const [preferredAgentId, setPreferredAgentId] = useState<string | null>(() => readStoredWebchatAgentId());
  const chatAgentsRef = useRef(chatAgentsData ?? null);
  const preferredAgentIdRef = useRef<string | null>(readStoredWebchatAgentId());

  useEffect(() => {
    chatAgentsRef.current = chatAgentsData ?? null;
  }, [chatAgentsData]);

  useEffect(() => {
    preferredAgentIdRef.current = preferredAgentId;
  }, [preferredAgentId]);

  useEffect(() => {
    if (!chatAgentsData) return;
    const valid = new Set(chatAgentsData.items.map((i) => i.id));
    setPreferredAgentId((cur) => {
      if (cur == null || cur === '') return chatAgentsData.defaultId;
      if (!valid.has(cur)) return chatAgentsData.defaultId;
      return cur;
    });
  }, [chatAgentsData]);

  const resolveAgentIdForPost = useCallback((): string | undefined => {
    const agents = chatAgentsRef.current;
    const pref = (preferredAgentIdRef.current ?? '').trim().toLowerCase();
    if (!agents) return pref || undefined;
    const valid = new Set(agents.items.map((i) => i.id));
    if (pref && valid.has(pref)) return pref;
    return agents.defaultId;
  }, []);

  const onChatAgentChange = useCallback(
    (id: string) => {
      const next = id.trim().toLowerCase();
      setPreferredAgentId(next);
      try {
        globalThis.localStorage?.setItem(WEBCHAT_AGENT_STORAGE_KEY, next);
      } catch {
        /* noop */
      }
      const curKey = sessionKeyRef.current;
      const curAgent = curKey ? getAgentIdFromWebSessionKey(curKey) : null;
      if (curAgent !== next) {
        navigate('/chat/new', { replace: false });
      }
    },
    [navigate],
  );

  const sessionMgrRef = useRef(new SessionManager());
  const senderRef = useRef(new MessageSender());
  const loadingSessionRef = useRef(false);
  const initGenRef = useRef(0);
  const sendingRef = useRef(false);
  const streamingRef = useRef(false);
  const sessionKeyRef = useRef<string | null>(null);
  const routeSessionKeyRef = useRef<string | null>(null);
  const activeStreamSessionKeyRef = useRef<string | null>(null);
  const activeResumeRunIdRef = useRef<string | null>(null);
  const sessionNameRef = useRef<string | null>(null);
  const thinkingSupportGenRef = useRef(0);
  /** Skip duplicate finalize when user already committed via `abort()` (SSE may still send `result`). */
  const userAbortedRef = useRef(false);

  const sendMessageRef = useRef<
    (
      content: string,
      attachments?: PendingFollowUp['attachments'],
      levelOverride?: string,
    ) => Promise<void>
  >(async () => {});
  const flushSteeringQueueRef = useRef<() => void>(() => {});

  const [messages, setMessages] = useState<Message[]>([]);
  const [streamingMsg, setStreamingMsg] = useState<Message | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clarifyPrompt, setClarifyPrompt] = useState<ClarifyPromptState | null>(null);
  const [clarifySubmitting, setClarifySubmitting] = useState(false);
  const clarifyPromptRef = useRef<ClarifyPromptState | null>(null);
  const [sessionKey, setSessionKey] = useState<string | null>(null);
  const [sessionName, setSessionName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionModel, setSessionModel] = useState('');
  const [thinkingLevel, setThinkingLevel] = useState(DEFAULT_THINKING);
  const [reasoningLevel, setReasoningLevel] = useState<ReasoningLevel>(DEFAULT_REASONING);
  const [modelSupportsThinking, setModelSupportsThinking] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const messagesLenRef = useRef(0);
  const [pendingFollowUps, setPendingFollowUps] = useState<PendingFollowUp[]>([]);
  const pendingFollowUpsRef = useRef<PendingFollowUp[]>([]);
  const [steeringFollowUpId, setSteeringFollowUpId] = useState<string | null>(null);
  const [followUpSuggestions, setFollowUpSuggestions] = useState<FollowUpSuggestionId[]>([]);

  useEffect(() => {
    sendingRef.current = sending;
  }, [sending]);
  useEffect(() => {
    streamingRef.current = streaming;
  }, [streaming]);
  useEffect(() => {
    sessionKeyRef.current = sessionKey;
  }, [sessionKey]);
  useEffect(() => {
    sessionNameRef.current = sessionName;
  }, [sessionName]);
  useEffect(() => {
    clarifyPromptRef.current = clarifyPrompt;
  }, [clarifyPrompt]);
  useEffect(() => {
    messagesLenRef.current = messages.length;
  }, [messages.length]);

  useEffect(() => {
    pendingFollowUpsRef.current = [];
    setPendingFollowUps([]);
    setFollowUpSuggestions([]);
  }, [sessionKey]);

  useEffect(() => {
    pendingFollowUpsRef.current = pendingFollowUps;
  }, [pendingFollowUps]);

  useEffect(() => {
    if (!sessionKey) return;
    const a = getAgentIdFromWebSessionKey(sessionKey);
    if (!a) return;
    setPreferredAgentId((p) => (a !== p ? a : p));
    try {
      globalThis.localStorage?.setItem(WEBCHAT_AGENT_STORAGE_KEY, a);
    } catch {
      /* noop */
    }
  }, [sessionKey]);

  const isNewRoute = location.pathname.endsWith('/new');
  const decodedKey = sessionKeyParam ? decodeURIComponent(sessionKeyParam) : undefined;
  // Keep route key in sync during render so refresh-time resume callbacks are not gated
  // by effect scheduling order.
  routeSessionKeyRef.current = decodedKey ?? null;

  /** URL session param does not match loaded state yet (switching sessions or first paint). */
  const sessionRoutePending = Boolean(decodedKey !== undefined && sessionKey !== decodedKey);
  /**
   * Full-height loading in the message column — only when we have no session key in state yet
   * or we're on `/chat` without a param (pick-session flow). Never when switching `/chat/A`→`/chat/B`
   * (keeps shell layout while session/messages load).
   */
  const showSessionLoading = useMemo(
    () => loading && (sessionKey == null || decodedKey === undefined),
    [loading, sessionKey, decodedKey],
  );

  const navigateToSession = useCallback(
    (key: string, replace = true) => {
      navigate(`/chat/${encodeURIComponent(key)}`, { replace });
    },
    [navigate],
  );

  const refreshModelThinkingSupport = useCallback(async (modelId: string) => {
    const gen = ++thinkingSupportGenRef.current;
    if (!modelId.trim()) {
      if (gen === thinkingSupportGenRef.current) setModelSupportsThinking(false);
      return;
    }
    const supports = await modelSupportsReasoning(modelId);
    if (gen !== thinkingSupportGenRef.current) return;
    setModelSupportsThinking(supports);
  }, []);

  const pollSessionNameAfterTurn = useCallback(async () => {
    const key = sessionKeyRef.current;
    if (!key) return;
    for (let i = 0; i < 8; i++) {
      await new Promise<void>((r) => setTimeout(r, i === 0 ? 500 : 700));
      if (sessionKeyRef.current !== key) return;
      if (sessionNameRef.current?.trim()) return;
      try {
        const name = await sessionMgrRef.current.fetchSessionName(key);
        if (name) {
          setSessionName(name);
          return;
        }
      } catch {
        /* ignore */
      }
    }
  }, []);

  /**
   * Commit streaming assistant bubble into `messages` and clear `streamingMsg`.
   * Do not call `setMessages` inside `setStreamingMsg`'s updater — React Strict Mode
   * invokes that updater twice in development, which duplicated assistant rows.
   */
  const finalizeMessage = useCallback(
    (opts?: { skipSteeringQueueFlush?: boolean }) => {
      let finalMsg: Message | null = null;
      flushSync(() => {
        setStreamingMsg((prev) => {
          if (!prev) return null;
          const msg = ensureAssistantMessage(prev, Date.now());
          finalizeStreamingThinking(msg.content);
          finalizeRunningTools(msg.content);
          finalMsg = cloneMessageForRender(msg);
          return null;
        });
      });
      const appended = finalMsg;
      if (appended && hasRenderableAssistantContent(appended)) {
        setMessages((m) => mergeConsecutiveAssistantMessages([...m, appended]));
        setFollowUpSuggestions(suggestFollowUpsFromAssistantMessage(appended));
      }
      setStreaming(false);
      setProgress(null);
      setSending(false);
      sendingRef.current = false;
      streamingRef.current = false;
      activeStreamSessionKeyRef.current = null;
      activeResumeRunIdRef.current = null;
      setClarifyPrompt(null);
      void pollSessionNameAfterTurn();
      if (!opts?.skipSteeringQueueFlush) {
        queueMicrotask(() => {
          flushSteeringQueueRef.current();
        });
      }
    },
    [pollSessionNameAfterTurn],
  );

  /**
   * Only apply streaming deltas to the visible chat when the browser route still points
   * at the same session that started this stream. Prevents cross-session bleed while
   * preserving the ability to switch back and continue seeing live updates.
   */
  const shouldApplyStreamUpdate = useCallback((streamSessionKey: string) => {
    const routeKey = routeSessionKeyRef.current;
    if (routeKey) {
      return routeKey === streamSessionKey;
    }
    return sessionKeyRef.current === streamSessionKey;
  }, []);

  const loadSessionById = useCallback(
    async (key: string, offset = 0) => {
      if (offset === 0 && key === sessionKeyRef.current && (sendingRef.current || streamingRef.current)) {
        return;
      }
      // Dismiss any clarify prompt from the previous session.
      if (offset === 0) {
        setClarifyPrompt(null);
      }
      if (loadingSessionRef.current) return;
      loadingSessionRef.current = true;

      try {
        const { messages: loaded, hasMore: more, name } = await sessionMgrRef.current.loadSession(key, offset);
        if (offset === 0) {
          setSessionKey(key);
          setSessionName(name ?? null);
          setMessages(loaded);
          setHasMore(more);
          setError(null);
          try {
            const cfg = await sessionMgrRef.current.loadSessionAgentConfig(key);
            setSessionModel(cfg.model);
            setThinkingLevel(cfg.thinkingLevel || DEFAULT_THINKING);
            setReasoningLevel(coerceReasoningLevel(cfg.reasoningLevel));
            void refreshModelThinkingSupport(cfg.model);
          } catch {
            /* gateway may be older */
          }
        } else {
          setMessages((prev) => {
            const existing = new Set(prev.map((m) => m.timestamp));
            const prepended = loaded.filter((m) => !existing.has(m.timestamp));
            return mergeConsecutiveAssistantMessages([...prepended, ...prev]);
          });
          setHasMore(more);
        }
      } catch {
        if (offset === 0) {
          setError('Failed to load session');
          const sessions = await sessionMgrRef.current.loadSessions().catch(() => [] as SessionInfo[]);
          const withMsgs = sessions.filter((s) => (s.messageCount ?? 0) > 0);
          const target = withMsgs[0] ?? sessions[0];
          if (target) {
            navigateToSession(target.key);
            await loadSessionById(target.key, 0);
          } else {
            try {
              const aid = resolveAgentIdForPost();
              const session = await sessionMgrRef.current.createSession(
                aid ? { agentId: aid } : undefined,
              );
              navigateToSession(session.key);
              setSessionKey(session.key);
              setMessages([]);
              setHasMore(false);
              try {
                const cfg = await sessionMgrRef.current.loadSessionAgentConfig(session.key);
                setSessionModel(cfg.model);
                setThinkingLevel(cfg.thinkingLevel || DEFAULT_THINKING);
                setReasoningLevel(coerceReasoningLevel(cfg.reasoningLevel));
                void refreshModelThinkingSupport(cfg.model);
              } catch {
                /* ignore */
              }
            } catch {
              setError('Could not open a session');
            }
          }
        }
      } finally {
        loadingSessionRef.current = false;
      }
    },
    [navigateToSession, refreshModelThinkingSupport, resolveAgentIdForPost],
  );

  const loadMoreMessages = useCallback(async () => {
    const key = sessionKeyRef.current;
    if (!key || loadingMore || !hasMore || loadingSessionRef.current) return;
    setLoadingMore(true);
    try {
      await loadSessionById(key, messagesLenRef.current);
    } finally {
      setLoadingMore(false);
    }
  }, [hasMore, loadSessionById, loadingMore]);

  const onSessionModelChange = useCallback(
    async (modelId: string) => {
      if (!sessionKey) return;
      try {
        setError(null);
        await sessionMgrRef.current.patchSessionAgentConfig(sessionKey, { model: modelId });
        setSessionModel(modelId);
        void refreshModelThinkingSupport(modelId);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to switch model');
      }
    },
    [sessionKey, refreshModelThinkingSupport],
  );

  const createNewSession = useCallback(async () => {
    setClarifyPrompt(null);
    try {
      const sessions = await sessionMgrRef.current.loadSessions();
      const aid = resolveAgentIdForPost();
      const empty = pickEmptyWebSessionForAgent(sessions, aid);
      if (empty) {
        setSessionKey(empty.key);
        setSessionName(empty.name ?? null);
        setMessages([]);
        setHasMore(false);
        navigateToSession(empty.key);
        try {
          const cfg = await sessionMgrRef.current.loadSessionAgentConfig(empty.key);
          setSessionModel(cfg.model);
          setThinkingLevel(cfg.thinkingLevel || DEFAULT_THINKING);
          setReasoningLevel(coerceReasoningLevel(cfg.reasoningLevel));
          void refreshModelThinkingSupport(cfg.model);
        } catch {
          /* ignore */
        }
        return;
      }
      const session = await sessionMgrRef.current.createSession(
        aid ? { agentId: aid } : undefined,
      );
      setSessionKey(session.key);
      setSessionName(session.name ?? null);
      setMessages([]);
      setHasMore(false);
      navigateToSession(session.key);
      try {
        const cfg = await sessionMgrRef.current.loadSessionAgentConfig(session.key);
        setSessionModel(cfg.model);
        setThinkingLevel(cfg.thinkingLevel || DEFAULT_THINKING);
        setReasoningLevel(coerceReasoningLevel(cfg.reasoningLevel));
        void refreshModelThinkingSupport(cfg.model);
      } catch {
        /* ignore */
      }
    } catch (err) {
      console.error('[chat] createNewSession failed:', err);
    }
  }, [navigateToSession, refreshModelThinkingSupport, resolveAgentIdForPost]);

  const tryResumeAgentRun = useCallback(async (chatId: string) => {
    const sender = senderRef.current;
    if (sendingRef.current || streamingRef.current) return;
    let stored: { runId: string } | null = null;
    try {
      const raw = sessionStorage.getItem(pendingAgentRunStorageKey(chatId));
      if (raw) stored = JSON.parse(raw) as { runId: string };
    } catch {
      /* ignore */
    }
    if (!stored?.runId) return;
    if (activeResumeRunIdRef.current === stored.runId) return;

    userAbortedRef.current = false;
    activeResumeRunIdRef.current = stored.runId;
    activeStreamSessionKeyRef.current = chatId;
    sendingRef.current = true;
    streamingRef.current = true;
    setSending(true);
    setStreaming(true);
    setProgress(null);
    let hydratedResumeTail = false;
    const hydrateResumeTailAssistant = () => {
      if (hydratedResumeTail) return;
      hydratedResumeTail = true;
      let extractedTail: Message | null = null;
      flushSync(() => {
        setMessages((prev) => {
          if (prev.length === 0) return prev;
          const last = prev[prev.length - 1];
          if (last?.role !== 'assistant') return prev;
          extractedTail = cloneMessageForRender(last);
          return prev.slice(0, -1);
        });
        if (extractedTail) {
          setStreamingMsg((prev) => prev ?? extractedTail);
        }
      });
    };

    try {
      await sender.resume(stored.runId, chatId, {
        onStreamStart: () => {
          if (!shouldApplyStreamUpdate(chatId)) return;
          hydrateResumeTailAssistant();
          setStreamingMsg((prev) => cloneMessageForRender(ensureAssistantMessage(prev, Date.now())));
        },
        onToken: (delta) => {
          if (!shouldApplyStreamUpdate(chatId)) return;
          hydrateResumeTailAssistant();
          setStreamingMsg((prev) => {
            const msg = ensureAssistantMessage(prev, Date.now());
            appendTextDelta(msg.content, delta);
            return cloneMessageForRender(msg);
          });
          setStreaming(true);
        },
        onThinking: (c, isDelta) => {
          if (!shouldApplyStreamUpdate(chatId)) return;
          hydrateResumeTailAssistant();
          setStreamingMsg((prev) => {
            const msg = ensureAssistantMessage(prev, Date.now());
            if (!isDelta && c === '') startThinkingSegment(msg.content);
            else appendThinkingDelta(msg.content, c, isDelta);
            return cloneMessageForRender(msg);
          });
        },
        onThinkingEnd: () => {
          if (!shouldApplyStreamUpdate(chatId)) return;
          hydrateResumeTailAssistant();
          setStreamingMsg((prev) => {
            if (!prev) return prev;
            const msg = ensureAssistantMessage(prev, Date.now());
            finalizeStreamingThinking(msg.content);
            return cloneMessageForRender(msg);
          });
        },
        onToolStart: (toolName, args) => {
          if (!shouldApplyStreamUpdate(chatId)) return;
          hydrateResumeTailAssistant();
          setStreamingMsg((prev) => {
            const msg = ensureAssistantMessage(prev, Date.now());
            appendToolStart(msg.content, toolName, args);
            return cloneMessageForRender(msg);
          });
          setStreaming(true);
        },
        onToolEnd: (toolName, isErr, result) => {
          if (!shouldApplyStreamUpdate(chatId)) return;
          // Resume replays buffered SSE from the start, including `clarify_request` events for
          // clarifications already answered — only `tool_end(clarify)` reflects completion.
          if (toolName === 'clarify') {
            setClarifyPrompt(null);
          }
          hydrateResumeTailAssistant();
          setStreamingMsg((prev) => {
            const msg = ensureAssistantMessage(prev, Date.now());
            completeTool(msg.content, toolName, isErr, result);
            return cloneMessageForRender(msg);
          });
        },
        onProgress: (p) => {
          if (!shouldApplyStreamUpdate(chatId)) return;
          setProgress(p);
        },
        onTtsAudio: (p) => {
          if (!shouldApplyStreamUpdate(chatId)) return;
          setStreamingMsg((prev) => {
            const msg = ensureAssistantMessage(prev, Date.now());
            const rel = p.workspaceRelativePath?.replace(/\\/g, '/').trim();
            const existing = msg.attachments ?? [];
            if (rel && existing.some((a) => a.workspaceRelativePath?.replace(/\\/g, '/').trim() === rel)) {
              return cloneMessageForRender(msg);
            }
            const nextAtt = {
              name: p.name,
              mimeType: p.mimeType,
              type: 'voice' as const,
              workspaceRelativePath: p.workspaceRelativePath,
              size: 0,
            };
            msg.attachments = [...existing, nextAtt];
            return cloneMessageForRender(msg);
          });
        },
        onClarifyRequest: (payload) => {
          if (!shouldApplyStreamUpdate(chatId)) return;
          // Pause the "AI is running" UI state so the composer shows the clarify prompt
          // instead of the stop button. The SSE stream stays open waiting for the answer.
          sendingRef.current = false;
          streamingRef.current = false;
          setSending(false);
          setStreaming(false);
          setProgress(null);
          setClarifyPrompt(payload);
        },
        onResult: () => {
          if (!shouldApplyStreamUpdate(chatId)) {
            activeStreamSessionKeyRef.current = null;
            activeResumeRunIdRef.current = null;
            sendingRef.current = false;
            streamingRef.current = false;
            setStreaming(false);
            setSending(false);
            setProgress(null);
            setClarifyPrompt(null);
            return;
          }
          if (userAbortedRef.current) {
            userAbortedRef.current = false;
            return;
          }
          finalizeMessage();
        },
        onError: (msg) => {
          if (!shouldApplyStreamUpdate(chatId)) {
            activeStreamSessionKeyRef.current = null;
            activeResumeRunIdRef.current = null;
            sendingRef.current = false;
            streamingRef.current = false;
            setStreaming(false);
            setSending(false);
            setProgress(null);
            setClarifyPrompt(null);
            return;
          }
          activeResumeRunIdRef.current = null;
          sendingRef.current = false;
          streamingRef.current = false;
          setError(msg);
          setStreamingMsg(null);
          setStreaming(false);
          setSending(false);
          setProgress(null);
          setClarifyPrompt(null);
        },
      });
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        console.error('[chat] resume failed:', err);
      }
      activeResumeRunIdRef.current = null;
      sendingRef.current = false;
      streamingRef.current = false;
      setStreaming(false);
      setSending(false);
      setStreamingMsg(null);
      setProgress(null);
      if (activeStreamSessionKeyRef.current === chatId) {
        activeStreamSessionKeyRef.current = null;
      }
    }
  }, [finalizeMessage, shouldApplyStreamUpdate]);

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

  const popPendingFollowUpForComposer = useCallback((id: string) => {
    const row = pendingFollowUpsRef.current.find((r) => r.id === id);
    if (!row) return null;
    setPendingFollowUps((prev) => {
      const next = prev.filter((r) => r.id !== id);
      pendingFollowUpsRef.current = next;
      return next;
    });
    return {
      text: row.text,
      attachments: row.attachments ?? [],
      thinkingLevel: row.thinkingLevel,
    };
  }, []);

  const removePendingFollowUp = useCallback((id: string) => {
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
      }
    } catch {
      /* ignore */
    } finally {
      setSteeringFollowUpId(null);
    }
  }, []);

  const interruptAndSend = useCallback(
    async (
      content: string,
      attachments?: Array<{ type: string; mimeType?: string; data?: string; name?: string; size?: number }>,
      levelOverride?: string,
    ) => {
      if (!content.trim() && !attachments?.length) return;
      if (!sendingRef.current && !streamingRef.current) return;
      const trimmed = content.trim();
      if (trimmed === '/new' && !attachments?.length) {
        await createNewSession();
        return;
      }
      const key = sessionKeyRef.current;
      if (!key) return;
      pendingFollowUpsRef.current = [];
      setPendingFollowUps([]);
      const effectiveThinking = modelSupportsThinking ? (levelOverride ?? thinkingLevel) : 'off';
      userAbortedRef.current = true;
      activeResumeRunIdRef.current = null;
      activeStreamSessionKeyRef.current = null;
      senderRef.current.abort();
      sendingRef.current = false;
      streamingRef.current = false;
      setClarifyPrompt(null);
      finalizeMessage({ skipSteeringQueueFlush: true });
      setProgress(null);
      queueMicrotask(() => {
        void sendMessageRef.current(content, attachments, effectiveThinking);
      });
    },
    [createNewSession, finalizeMessage, modelSupportsThinking, thinkingLevel],
  );

  const pickFollowUpSuggestion = useCallback(
    (text: string) => {
      const t = text.trim();
      if (!t) return;
      setFollowUpSuggestions([]);
      void sendMessageRef.current(t, undefined, undefined);
    },
    [],
  );

  const sendMessage = useCallback(
    async (
      content: string,
      attachments?: Array<{ type: string; mimeType?: string; data?: string; name?: string; size?: number }>,
      levelOverride?: string,
    ) => {
      if ((!content.trim() && !attachments?.length) || sendingRef.current || streamingRef.current) return;

      const trimmed = content.trim();
      if (trimmed === '/new' && !attachments?.length) {
        await createNewSession();
        return;
      }

      if (!sessionKey) return;

      const effectiveThinking = modelSupportsThinking ? (levelOverride ?? thinkingLevel) : 'off';

      const sender = senderRef.current;
      const chatId = sessionKey;
      userAbortedRef.current = false;
      setFollowUpSuggestions([]);
      activeStreamSessionKeyRef.current = chatId;
      setSending(true);
      setError(null);
      // Clear any stale clarify prompt from a previous turn so its requestId
      // cannot be accidentally re-submitted against the new run.
      setClarifyPrompt(null);
      setMessages((m) => [
        ...m,
        {
          role: 'user',
          content: content ? [{ type: 'text', text: content }] : [],
          attachments,
          timestamp: Date.now(),
        },
      ]);

      try {
        await sender.send(content, chatId, attachments, effectiveThinking, {
          onStreamStart: () => {
            if (!shouldApplyStreamUpdate(chatId)) return;
            setStreaming(true);
            setStreamingMsg((prev) => cloneMessageForRender(ensureAssistantMessage(prev, Date.now())));
          },
          onToken: (delta) => {
            if (!shouldApplyStreamUpdate(chatId)) return;
            setStreamingMsg((prev) => {
              const msg = ensureAssistantMessage(prev, Date.now());
              appendTextDelta(msg.content, delta);
              return cloneMessageForRender(msg);
            });
            setStreaming(true);
          },
          onThinking: (c, isDelta) => {
            if (!shouldApplyStreamUpdate(chatId)) return;
            setStreamingMsg((prev) => {
              const msg = ensureAssistantMessage(prev, Date.now());
              if (!isDelta && c === '') startThinkingSegment(msg.content);
              else appendThinkingDelta(msg.content, c, isDelta);
              return cloneMessageForRender(msg);
            });
          },
          onThinkingEnd: () => {
            if (!shouldApplyStreamUpdate(chatId)) return;
            setStreamingMsg((prev) => {
              if (!prev) return prev;
              const msg = ensureAssistantMessage(prev, Date.now());
              finalizeStreamingThinking(msg.content);
              return cloneMessageForRender(msg);
            });
          },
          onToolStart: (toolName, args) => {
            if (!shouldApplyStreamUpdate(chatId)) return;
            setStreamingMsg((prev) => {
              const msg = ensureAssistantMessage(prev, Date.now());
              appendToolStart(msg.content, toolName, args);
              return cloneMessageForRender(msg);
            });
            setStreaming(true);
          },
          onToolEnd: (toolName, isErr, result) => {
            if (!shouldApplyStreamUpdate(chatId)) return;
            if (toolName === 'clarify') {
              setClarifyPrompt(null);
            }
            setStreamingMsg((prev) => {
              const msg = ensureAssistantMessage(prev, Date.now());
              completeTool(msg.content, toolName, isErr, result);
              return cloneMessageForRender(msg);
            });
          },
          onProgress: (p) => {
            if (!shouldApplyStreamUpdate(chatId)) return;
            setProgress(p);
          },
          onTtsAudio: (p) => {
            if (!shouldApplyStreamUpdate(chatId)) return;
            setStreamingMsg((prev) => {
              const msg = ensureAssistantMessage(prev, Date.now());
              const rel = p.workspaceRelativePath?.replace(/\\/g, '/').trim();
              const existing = msg.attachments ?? [];
              if (rel && existing.some((a) => a.workspaceRelativePath?.replace(/\\/g, '/').trim() === rel)) {
                return cloneMessageForRender(msg);
              }
              const nextAtt = {
                name: p.name,
                mimeType: p.mimeType,
                type: 'voice' as const,
                workspaceRelativePath: p.workspaceRelativePath,
                size: 0,
              };
              msg.attachments = [...existing, nextAtt];
              return cloneMessageForRender(msg);
            });
          },
          onClarifyRequest: (payload) => {
            if (!shouldApplyStreamUpdate(chatId)) return;
            // Pause the "AI is running" UI state so the composer shows the clarify prompt
            // instead of the stop button. The SSE stream stays open waiting for the answer.
            sendingRef.current = false;
            streamingRef.current = false;
            setSending(false);
            setStreaming(false);
            setProgress(null);
            setClarifyPrompt(payload);
          },
          onResult: () => {
            if (!shouldApplyStreamUpdate(chatId)) {
              activeStreamSessionKeyRef.current = null;
              sendingRef.current = false;
              streamingRef.current = false;
              setStreaming(false);
              setSending(false);
              setProgress(null);
              setClarifyPrompt(null);
              return;
            }
            if (userAbortedRef.current) {
              userAbortedRef.current = false;
              return;
            }
            finalizeMessage();
          },
          onError: (msg) => {
            if (!shouldApplyStreamUpdate(chatId)) {
              activeStreamSessionKeyRef.current = null;
              sendingRef.current = false;
              streamingRef.current = false;
              setStreaming(false);
              setSending(false);
              setProgress(null);
              setClarifyPrompt(null);
              return;
            }
            sendingRef.current = false;
            streamingRef.current = false;
            setError(msg);
            setStreamingMsg(null);
            setStreaming(false);
            setSending(false);
            setProgress(null);
            setClarifyPrompt(null);
          },
        });
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          setError(err instanceof Error ? err.message : 'Send failed');
          setStreamingMsg(null);
          setStreaming(false);
        }
      } finally {
      sendingRef.current = false;
      streamingRef.current = false;
        setSending(false);
        if (activeStreamSessionKeyRef.current === chatId) {
          activeStreamSessionKeyRef.current = null;
        }
      }
    },
    [
      sessionKey,
      thinkingLevel,
      modelSupportsThinking,
      finalizeMessage,
      shouldApplyStreamUpdate,
      createNewSession,
    ],
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
      // Always dismiss after a response so 4xx/5xx (e.g. stale requestId) cannot block the composer.
      setClarifyPrompt(null);
    } finally {
      setClarifySubmitting(false);
    }
  }, []);

  const abort = useCallback(() => {
    userAbortedRef.current = true;
    activeResumeRunIdRef.current = null;
    activeStreamSessionKeyRef.current = null;
    pendingFollowUpsRef.current = [];
    setPendingFollowUps([]);
    senderRef.current.abort();
    sendingRef.current = false;
    streamingRef.current = false;
    setClarifyPrompt(null);
    finalizeMessage({ skipSteeringQueueFlush: true });
    setProgress(null);
    const key = sessionKeyRef.current;
    if (key) {
      window.setTimeout(() => {
        void loadSessionById(key, 0);
      }, 300);
    }
  }, [finalizeMessage, loadSessionById]);

  useEffect(() => {
    const active = activeStreamSessionKeyRef.current;
    if (!decodedKey) return;
    // Always clear clarify prompt when navigating to a different session,
    // even if there is no active stream — the prompt is session-scoped.
    if (decodedKey !== sessionKeyRef.current) {
      setClarifyPrompt(null);
    }
    if (!active || decodedKey === active) return;
    setStreamingMsg(null);
    setProgress(null);
    setStreaming(false);
    setSending(false);
  }, [decodedKey]);

  /** Avoid copying `messages` on every render when no streaming row — keeps stable array ref for memoized bubbles. */
  const displayMessages = useMemo(() => {
    if (!streamingMsg) return messages;
    return [...messages, streamingMsg];
  }, [messages, streamingMsg]);

  useEffect(() => {
    const handler = (e: Event) => {
      const d = (e as CustomEvent<{ key?: string; name?: string }>).detail;
      if (!d?.key || d.name === undefined) return;
      if (d.key === sessionKey) setSessionName(d.name || null);
    };
    window.addEventListener('session-updated', handler as EventListener);
    return () => window.removeEventListener('session-updated', handler as EventListener);
  }, [sessionKey]);

  /** After settings PATCH / gateway reload, resolved reasoning/thinking use new defaults (session overrides still win). */
  useEffect(() => {
    const onConfigReload = () => {
      const key = sessionKeyRef.current;
      if (!key) return;
      void sessionMgrRef.current
        .loadSessionAgentConfig(key)
        .then((cfg) => {
          setSessionModel(cfg.model);
          setThinkingLevel(cfg.thinkingLevel || DEFAULT_THINKING);
          setReasoningLevel(coerceReasoningLevel(cfg.reasoningLevel));
          void refreshModelThinkingSupport(cfg.model);
        })
        .catch(() => {});
    };
    window.addEventListener('config-reload', onConfigReload as EventListener);
    return () => window.removeEventListener('config-reload', onConfigReload as EventListener);
  }, [refreshModelThinkingSupport]);

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }

    const gen = ++initGenRef.current;
    let cancelled = false;

    const run = async () => {
      const needsFullBlockingLoad = isNewRoute || decodedKey === undefined;
      if (needsFullBlockingLoad) {
        setLoading(true);
      }
      setError(null);

      try {
        if (isNewRoute) {
          const sessions = await sessionMgrRef.current.loadSessions();
          if (cancelled || gen !== initGenRef.current) return;
          const aid = resolveAgentIdForPost();
          const empty = pickEmptyWebSessionForAgent(sessions, aid);
          if (empty) {
            setSessionKey(empty.key);
            setSessionName(empty.name ?? null);
            setMessages([]);
            setHasMore(false);
            navigateToSession(empty.key);
            try {
              const cfg = await sessionMgrRef.current.loadSessionAgentConfig(empty.key);
              setSessionModel(cfg.model);
              setThinkingLevel(cfg.thinkingLevel || DEFAULT_THINKING);
              setReasoningLevel(coerceReasoningLevel(cfg.reasoningLevel));
              void refreshModelThinkingSupport(cfg.model);
            } catch {
              /* ignore */
            }
          } else {
            const session = await sessionMgrRef.current.createSession(
              aid ? { agentId: aid } : undefined,
            );
            if (cancelled || gen !== initGenRef.current) return;
            setSessionKey(session.key);
            setSessionName(session.name ?? null);
            setMessages([]);
            setHasMore(false);
            navigateToSession(session.key);
            try {
              const cfg = await sessionMgrRef.current.loadSessionAgentConfig(session.key);
              setSessionModel(cfg.model);
              setThinkingLevel(cfg.thinkingLevel || DEFAULT_THINKING);
              setReasoningLevel(coerceReasoningLevel(cfg.reasoningLevel));
              void refreshModelThinkingSupport(cfg.model);
            } catch {
              /* ignore */
            }
          }
        } else if (decodedKey) {
          await loadSessionById(decodedKey, 0);
          if (!cancelled && gen === initGenRef.current) {
            await tryResumeAgentRun(decodedKey);
          }
        } else {
          const sessions = await sessionMgrRef.current.loadSessions();
          if (cancelled || gen !== initGenRef.current) return;
          const withMsgs = sessions.filter((s) => (s.messageCount ?? 0) > 0);
          const target = withMsgs[0] ?? sessions[0];
          if (target) {
            await loadSessionById(target.key, 0);
            if (cancelled || gen !== initGenRef.current) return;
            const keyFromUrl = sessionMgrRef.current.parseSessionFromHash();
            if (!keyFromUrl) navigateToSession(target.key);
            await tryResumeAgentRun(target.key);
          } else {
            const aid = resolveAgentIdForPost();
            const session = await sessionMgrRef.current.createSession(
              aid ? { agentId: aid } : undefined,
            );
            if (cancelled || gen !== initGenRef.current) return;
            setSessionKey(session.key);
            setSessionName(session.name ?? null);
            setMessages([]);
            setHasMore(false);
            navigateToSession(session.key);
            try {
              const cfg = await sessionMgrRef.current.loadSessionAgentConfig(session.key);
              setSessionModel(cfg.model);
              setThinkingLevel(cfg.thinkingLevel || DEFAULT_THINKING);
              setReasoningLevel(coerceReasoningLevel(cfg.reasoningLevel));
              void refreshModelThinkingSupport(cfg.model);
            } catch {
              /* ignore */
            }
          }
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Chat init failed');
      } finally {
        if (!cancelled && gen === initGenRef.current) setLoading(false);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [
    token,
    isNewRoute,
    decodedKey,
    navigateToSession,
    loadSessionById,
    tryResumeAgentRun,
    refreshModelThinkingSupport,
    resolveAgentIdForPost,
  ]);

  const displayAgentId =
    (sessionKey && getAgentIdFromWebSessionKey(sessionKey)) ||
    preferredAgentId ||
    chatAgentsData?.defaultId ||
    'main';
  const showChatAgentSelector = (chatAgentsData?.items.length ?? 0) > 1;

  sendMessageRef.current = sendMessage;
  flushSteeringQueueRef.current = () => {
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
    pendingFollowUpsRef.current = rest;
    setPendingFollowUps(rest);
    void sendMessageRef.current(first.text, first.attachments, first.thinkingLevel);
  };

  return {
    messages: displayMessages,
    sessionKey,
    sessionName,
    decodedKey,
    sessionRoutePending,
    showSessionLoading,
    sessionModel,
    thinkingLevel,
    setThinkingLevel,
    reasoningLevel,
    modelSupportsThinking,
    hasMore,
    loadingMore,
    loadMoreMessages,
    onSessionModelChange,
    createNewSession,
    loading,
    error,
    streaming,
    sending,
    progress,
    sendMessage,
    addPendingFollowUp,
    pendingFollowUps,
    popPendingFollowUpForComposer,
    removePendingFollowUp,
    movePendingFollowUp,
    reorderPendingFollowUp,
    steerPendingFollowUp,
    steeringFollowUpId,
    interruptAndSend,
    abort,
    followUpSuggestions,
    pickFollowUpSuggestion,
    clarifyPrompt,
    clarifySubmitting,
    submitClarifyAnswer,
    hasToken: Boolean(token),
    chatAgents: chatAgentsData,
    displayAgentId,
    showChatAgentSelector,
    onChatAgentChange,
    sessionManager: sessionMgrRef.current,
  };
}
