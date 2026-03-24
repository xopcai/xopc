import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';

import type { Message, ProgressState } from '@/features/chat/messages.types';
import type { SessionInfo } from '@/features/chat/chat.types';
import { pendingAgentRunStorageKey, MessageSender } from '@/features/chat/message-sender';
import { SessionManager } from '@/features/chat/session-manager';
import {
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

  const [messages, setMessages] = useState<Message[]>([]);
  const [streamingMsg, setStreamingMsg] = useState<Message | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sessionKey, setSessionKey] = useState<string | null>(null);
  const [sessionName, setSessionName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [thinkingLevel] = useState(DEFAULT_THINKING);

  useEffect(() => {
    sendingRef.current = sending;
  }, [sending]);
  useEffect(() => {
    streamingRef.current = streaming;
  }, [streaming]);

  const isNewRoute = location.pathname.endsWith('/new');
  const decodedKey = sessionKeyParam ? decodeURIComponent(sessionKeyParam) : undefined;

  const navigateToSession = useCallback(
    (key: string, replace = true) => {
      navigate(`/chat/${encodeURIComponent(key)}`, { replace });
    },
    [navigate],
  );

  const loadSessionById = useCallback(
    async (key: string) => {
      if (loadingSessionRef.current) return;
      loadingSessionRef.current = true;
      try {
        const { messages: loaded, name } = await sessionMgrRef.current.loadSession(key, 0);
        setSessionKey(key);
        setSessionName(name ?? null);
        setMessages(loaded);
        setError(null);
      } catch {
        setError('Failed to load session');
        const sessions = await sessionMgrRef.current.loadSessions().catch(() => [] as SessionInfo[]);
        const withMsgs = sessions.filter((s) => (s.messageCount ?? 0) > 0);
        const target = withMsgs[0] ?? sessions[0];
        if (target) {
          navigateToSession(target.key);
          await loadSessionById(target.key);
        } else {
          try {
            const session = await sessionMgrRef.current.createSession();
            navigateToSession(session.key);
            setSessionKey(session.key);
            setMessages([]);
          } catch {
            setError('Could not open a session');
          }
        }
      } finally {
        loadingSessionRef.current = false;
      }
    },
    [navigateToSession],
  );

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
            else {
              const last = msg.content[msg.content.length - 1];
              if (last?.type === 'thinking') {
                if (isDelta) last.text = (last.text || '') + c;
                else last.text = c;
                last.streaming = true;
              } else {
                msg.content.push({ type: 'thinking', text: isDelta ? c : c, streaming: true });
              }
            }
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
        onResult: () => {
          setStreamingMsg((prev) => {
            if (!prev) return null;
            const msg = ensureAssistantMessage(prev, Date.now());
            finalizeStreamingThinking(msg.content);
            setMessages((m) => [...m, cloneMessageForRender(msg)]);
            return null;
          });
          setStreaming(false);
          setSending(false);
          setProgress(null);
        },
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
  }, []);

  const finalizeMessage = useCallback(() => {
    setStreamingMsg((prev) => {
      if (!prev) return null;
      const msg = ensureAssistantMessage(prev, Date.now());
      finalizeStreamingThinking(msg.content);
      setMessages((m) => [...m, cloneMessageForRender(msg)]);
      return null;
    });
    setStreaming(false);
    setProgress(null);
    setSending(false);
  }, []);

  const sendMessage = useCallback(
    async (content: string) => {
      if (!content.trim() || sendingRef.current || streamingRef.current) return;
      if (!sessionKey) return;

      const sender = senderRef.current;
      setSending(true);
      setError(null);
      setMessages((m) => [
        ...m,
        {
          role: 'user',
          content: content ? [{ type: 'text', text: content }] : [],
          timestamp: Date.now(),
        },
      ]);

      try {
        await sender.send(content, sessionKey, undefined, thinkingLevel, {
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
              else {
                const last = msg.content[msg.content.length - 1];
                if (last?.type === 'thinking') {
                  if (isDelta) last.text = (last.text || '') + c;
                  else last.text = c;
                  last.streaming = true;
                } else {
                  msg.content.push({ type: 'thinking', text: isDelta ? c : c, streaming: true });
                }
              }
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
    [sessionKey, thinkingLevel, finalizeMessage],
  );

  const abort = useCallback(() => {
    senderRef.current.abort();
    setStreaming(false);
    setSending(false);
    setStreamingMsg(null);
    setProgress(null);
  }, []);

  const displayMessages = useMemo(() => {
    const list = [...messages];
    if (streamingMsg) list.push(streamingMsg);
    return list;
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
      setLoading(true);
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
            navigateToSession(empty.key);
          } else {
            const session = await sessionMgrRef.current.createSession();
            if (cancelled || gen !== initGenRef.current) return;
            setSessionKey(session.key);
            setSessionName(session.name ?? null);
            setMessages([]);
            navigateToSession(session.key);
          }
        } else if (decodedKey) {
          await loadSessionById(decodedKey);
          if (!cancelled && gen === initGenRef.current) {
            await tryResumeAgentRun(decodedKey);
          }
        } else {
          const sessions = await sessionMgrRef.current.loadSessions();
          if (cancelled || gen !== initGenRef.current) return;
          const withMsgs = sessions.filter((s) => (s.messageCount ?? 0) > 0);
          const target = withMsgs[0] ?? sessions[0];
          if (target) {
            await loadSessionById(target.key);
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
            navigateToSession(session.key);
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
  }, [token, isNewRoute, decodedKey, navigateToSession, loadSessionById, tryResumeAgentRun]);

  return {
    messages: displayMessages,
    sessionKey,
    sessionName,
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
