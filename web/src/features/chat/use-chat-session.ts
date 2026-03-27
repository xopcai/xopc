import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useLocation, useNavigate, useParams } from 'react-router-dom';

import type { Message, ProgressState } from '@/features/chat/messages.types';
import type { SessionInfo } from '@/features/chat/chat.types';
import { modelSupportsReasoning } from '@/features/chat/model-capabilities';
import { pendingAgentRunStorageKey, MessageSender } from '@/features/chat/message-sender';
import { SessionManager } from '@/features/chat/session-manager';
import {
  appendThinkingDelta,
  appendTextDelta,
  appendToolStart,
  cloneMessageForRender,
  completeTool,
  ensureAssistantMessage,
  finalizeStreamingThinking,
  startThinkingSegment,
} from '@/features/chat/streaming';
import { useGatewayStore } from '@/stores/gateway-store';

const DEFAULT_THINKING = 'medium';

export function useChatSession() {
  const navigate = useNavigate();
  const location = useLocation();
  const { sessionKey: sessionKeyParam } = useParams();
  const token = useGatewayStore((s) => s.token);

  const sessionMgrRef = useRef(new SessionManager());
  const senderRef = useRef(new MessageSender());
  const loadingSessionRef = useRef(false);
  const initGenRef = useRef(0);
  const sendingRef = useRef(false);
  const streamingRef = useRef(false);
  const sessionKeyRef = useRef<string | null>(null);
  const sessionNameRef = useRef<string | null>(null);
  const thinkingSupportGenRef = useRef(0);

  const [messages, setMessages] = useState<Message[]>([]);
  const [streamingMsg, setStreamingMsg] = useState<Message | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sessionKey, setSessionKey] = useState<string | null>(null);
  const [sessionName, setSessionName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionModel, setSessionModel] = useState('');
  const [thinkingLevel, setThinkingLevel] = useState(DEFAULT_THINKING);
  const [modelSupportsThinking, setModelSupportsThinking] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const messagesLenRef = useRef(0);

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
    messagesLenRef.current = messages.length;
  }, [messages.length]);

  const isNewRoute = location.pathname.endsWith('/new');
  const decodedKey = sessionKeyParam ? decodeURIComponent(sessionKeyParam) : undefined;

  /** URL session param does not match loaded state yet (switching sessions or first paint). */
  const sessionRoutePending = Boolean(decodedKey !== undefined && sessionKey !== decodedKey);
  /**
   * Full-height loading in the message column — only when we have no session key in state yet
   * or we're on `/chat` without a param (pick-session flow). Never when switching `/chat/A`→`/chat/B`
   * (matches legacy Lit: keep layout, swap messages when fetch completes).
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
    if (sessionNameRef.current?.trim()) return;
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
  const finalizeMessage = useCallback(() => {
    let finalMsg: Message | null = null;
    flushSync(() => {
      setStreamingMsg((prev) => {
        if (!prev) return null;
        const msg = ensureAssistantMessage(prev, Date.now());
        finalizeStreamingThinking(msg.content);
        finalMsg = cloneMessageForRender(msg);
        return null;
      });
    });
    const appended = finalMsg;
    if (appended) {
      setMessages((m) => [...m, appended]);
    }
    setStreaming(false);
    setProgress(null);
    setSending(false);
    void pollSessionNameAfterTurn();
  }, [pollSessionNameAfterTurn]);

  const loadSessionById = useCallback(
    async (key: string, offset = 0) => {
      if (offset === 0 && key === sessionKeyRef.current && (sendingRef.current || streamingRef.current)) {
        return;
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
            void refreshModelThinkingSupport(cfg.model);
          } catch {
            /* gateway may be older */
          }
        } else {
          setMessages((prev) => {
            const existing = new Set(prev.map((m) => m.timestamp));
            return [...loaded.filter((m) => !existing.has(m.timestamp)), ...prev];
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
              const session = await sessionMgrRef.current.createSession();
              navigateToSession(session.key);
              setSessionKey(session.key);
              setMessages([]);
              setHasMore(false);
              try {
                const cfg = await sessionMgrRef.current.loadSessionAgentConfig(session.key);
                setSessionModel(cfg.model);
                setThinkingLevel(cfg.thinkingLevel || DEFAULT_THINKING);
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
    [navigateToSession, refreshModelThinkingSupport],
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
    try {
      const sessions = await sessionMgrRef.current.loadSessions();
      const empty = sessions.find((s) => (s.messageCount ?? 0) === 0);
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
          void refreshModelThinkingSupport(cfg.model);
        } catch {
          /* ignore */
        }
        return;
      }
      const session = await sessionMgrRef.current.createSession();
      setSessionKey(session.key);
      setSessionName(session.name ?? null);
      setMessages([]);
      setHasMore(false);
      navigateToSession(session.key);
      try {
        const cfg = await sessionMgrRef.current.loadSessionAgentConfig(session.key);
        setSessionModel(cfg.model);
        setThinkingLevel(cfg.thinkingLevel || DEFAULT_THINKING);
        void refreshModelThinkingSupport(cfg.model);
      } catch {
        /* ignore */
      }
    } catch (err) {
      console.error('[chat] createNewSession failed:', err);
    }
  }, [navigateToSession, refreshModelThinkingSupport]);

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

    setSending(true);
    setStreaming(true);
    setProgress(null);

    try {
      await sender.resume(stored.runId, chatId, {
        onStreamStart: () => {
          setStreamingMsg((prev) => cloneMessageForRender(ensureAssistantMessage(prev, Date.now())));
        },
        onToken: (delta) => {
          setStreamingMsg((prev) => {
            const msg = ensureAssistantMessage(prev, Date.now());
            appendTextDelta(msg.content, delta);
            return cloneMessageForRender(msg);
          });
          setStreaming(true);
        },
        onThinking: (c, isDelta) => {
          setStreamingMsg((prev) => {
            const msg = ensureAssistantMessage(prev, Date.now());
            if (!isDelta && c === '') startThinkingSegment(msg.content);
            else appendThinkingDelta(msg.content, c, isDelta);
            return cloneMessageForRender(msg);
          });
        },
        onThinkingEnd: () => {
          setStreamingMsg((prev) => {
            if (!prev) return prev;
            const msg = ensureAssistantMessage(prev, Date.now());
            finalizeStreamingThinking(msg.content);
            return cloneMessageForRender(msg);
          });
        },
        onToolStart: (toolName, args) => {
          setStreamingMsg((prev) => {
            const msg = ensureAssistantMessage(prev, Date.now());
            appendToolStart(msg.content, toolName, args);
            return cloneMessageForRender(msg);
          });
          setStreaming(true);
        },
        onToolEnd: (toolName, isErr, result) => {
          setStreamingMsg((prev) => {
            const msg = ensureAssistantMessage(prev, Date.now());
            completeTool(msg.content, toolName, isErr, result);
            return cloneMessageForRender(msg);
          });
        },
        onProgress: (p) => setProgress(p),
        onTtsAudio: (p) => {
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
        onResult: finalizeMessage,
        onError: (msg) => {
          setError(msg);
          setStreamingMsg(null);
          setStreaming(false);
          setSending(false);
          setProgress(null);
        },
      });
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        console.error('[chat] resume failed:', err);
      }
      setStreaming(false);
      setSending(false);
      setStreamingMsg(null);
      setProgress(null);
    }
  }, [finalizeMessage, pollSessionNameAfterTurn]);

  const sendMessage = useCallback(
    async (
      content: string,
      attachments?: Array<{ type: string; mimeType?: string; data?: string; name?: string; size?: number }>,
      levelOverride?: string,
    ) => {
      if ((!content.trim() && !attachments?.length) || sendingRef.current || streamingRef.current) return;
      if (!sessionKey) return;

      const effectiveThinking = modelSupportsThinking ? (levelOverride ?? thinkingLevel) : 'off';

      const sender = senderRef.current;
      setSending(true);
      setError(null);
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
        await sender.send(content, sessionKey, attachments, effectiveThinking, {
          onStreamStart: () => {
            setStreaming(true);
            setStreamingMsg((prev) => cloneMessageForRender(ensureAssistantMessage(prev, Date.now())));
          },
          onToken: (delta) => {
            setStreamingMsg((prev) => {
              const msg = ensureAssistantMessage(prev, Date.now());
              appendTextDelta(msg.content, delta);
              return cloneMessageForRender(msg);
            });
            setStreaming(true);
          },
          onThinking: (c, isDelta) => {
            setStreamingMsg((prev) => {
              const msg = ensureAssistantMessage(prev, Date.now());
              if (!isDelta && c === '') startThinkingSegment(msg.content);
              else appendThinkingDelta(msg.content, c, isDelta);
              return cloneMessageForRender(msg);
            });
          },
          onThinkingEnd: () => {
            setStreamingMsg((prev) => {
              if (!prev) return prev;
              const msg = ensureAssistantMessage(prev, Date.now());
              finalizeStreamingThinking(msg.content);
              return cloneMessageForRender(msg);
            });
          },
          onToolStart: (toolName, args) => {
            setStreamingMsg((prev) => {
              const msg = ensureAssistantMessage(prev, Date.now());
              appendToolStart(msg.content, toolName, args);
              return cloneMessageForRender(msg);
            });
            setStreaming(true);
          },
          onToolEnd: (toolName, isErr, result) => {
            setStreamingMsg((prev) => {
              const msg = ensureAssistantMessage(prev, Date.now());
              completeTool(msg.content, toolName, isErr, result);
              return cloneMessageForRender(msg);
            });
          },
          onProgress: (p) => setProgress(p),
          onTtsAudio: (p) => {
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
          onResult: finalizeMessage,
          onError: (msg) => {
            setError(msg);
            setStreamingMsg(null);
            setStreaming(false);
            setSending(false);
            setProgress(null);
          },
        });
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          setError(err instanceof Error ? err.message : 'Send failed');
          setStreamingMsg(null);
          setStreaming(false);
        }
      } finally {
        setSending(false);
      }
    },
    [sessionKey, thinkingLevel, modelSupportsThinking, finalizeMessage],
  );

  const abort = useCallback(() => {
    senderRef.current.abort();
    setStreaming(false);
    setSending(false);
    setStreamingMsg(null);
    setProgress(null);
  }, []);

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
          const empty = sessions.find((s) => (s.messageCount ?? 0) === 0);
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
              void refreshModelThinkingSupport(cfg.model);
            } catch {
              /* ignore */
            }
          } else {
            const session = await sessionMgrRef.current.createSession();
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
            const session = await sessionMgrRef.current.createSession();
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
  }, [token, isNewRoute, decodedKey, navigateToSession, loadSessionById, tryResumeAgentRun, refreshModelThinkingSupport]);

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
    abort,
    hasToken: Boolean(token),
  };
}
