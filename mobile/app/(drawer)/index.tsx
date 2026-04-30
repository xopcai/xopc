/**
 * Chat screen — the main page inside the drawer.
 *
 * Header layout (matching web UI design):
 *   Left:   ☰ hamburger (open drawer) | + new chat
 *   Center: model name picker (pill shape)
 *   Right:  session management icon
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DrawerActions } from '@react-navigation/native';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, useColorScheme, View } from 'react-native';
import { Banner, Icon, IconButton, Snackbar, Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AgentMessageSender, type MessagingCallbacks } from '../../src/api/agent-client';
import { ChatComposer } from '../../src/features/chat/ChatComposer';
import { MessageList } from '../../src/features/chat/MessageList';
import type { Message, MessageContent, ProgressState } from '../../src/features/chat/messages.types';
import { useMessages } from '../../src/i18n/messages';
import { RenameDialog } from '../../src/features/sessions/RenameDialog';
import {
  appendTextDelta,
  appendThinkingDelta,
  appendToolStart,
  cloneMessageForRender,
  completeTool,
  ensureAssistantMessage,
  finalizeRunningTools,
  finalizeStreamingThinking,
  startThinkingSegment,
} from '../../src/features/chat/streaming';
import { fetchChatAgents } from '../../src/query/agents';
import { queryKeys } from '../../src/query/keys';
import { createSession, fetchSession, renameSession } from '../../src/query/sessions';
import { pendingRunStorageKey, storage } from '../../src/storage/mmkv';
import { useGatewayStore } from '../../src/stores/gateway-store';

// ── Session wire → UI message helpers (ported from web/src/features/chat/agent-messages.ts) ──

type WireMessage = {
  role?: string;
  content?: unknown;
  timestamp?: string | number;
  tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
  toolCalls?: Array<{ id?: string; name: string; args?: Record<string, unknown> }>;
  tool_call_id?: string;
  toolCallId?: string;
  isError?: boolean;
};

/** Parse a single content block from wire format. */
function parseContentBlock(b: Record<string, unknown>): MessageContent {
  const t = b.type;
  if (t === 'text') return { type: 'text', text: String(b.text ?? '') };
  if (t === 'thinking') return { type: 'thinking', text: String(b.text ?? b.thinking ?? ''), streaming: false };
  if (t === 'tool_use' || t === 'tool_call' || t === 'toolCall') {
    return {
      type: 'tool_use',
      id: String(b.id ?? `tool-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`),
      name: String(b.name ?? (b.function as { name?: string } | undefined)?.name ?? 'tool'),
      input: b.input ?? b.args ?? b.arguments ?? (b.function as { arguments?: unknown } | undefined)?.arguments,
      status: (b.status === 'running' || b.status === 'error') ? b.status : 'done' as const,
      result: b.result as string | undefined,
    };
  }
  if (t === 'image') return { type: 'image', source: b.source as { data?: string } | undefined };
  return { type: 'text', text: String(b.text ?? '') };
}

/** Normalize raw content to MessageContent[]. */
function normalizeContentBlocks(raw: unknown): MessageContent[] {
  if (raw == null) return [];
  if (typeof raw === 'string') return raw.trim() ? [{ type: 'text', text: raw }] : [];
  if (!Array.isArray(raw)) return [{ type: 'text', text: String(raw) }];
  return raw
    .filter((item): item is Record<string, unknown> => item != null && typeof item === 'object')
    .map(parseContentBlock);
}

/** Build assistant content, including top-level tool_calls / toolCalls fields. */
function buildAssistantContent(m: WireMessage): MessageContent[] {
  const blocks = normalizeContentBlocks(m.content);

  // OpenAI format: top-level tool_calls array
  if (Array.isArray(m.tool_calls)) {
    for (const call of m.tool_calls) {
      if (!call?.id || blocks.some((b) => b.type === 'tool_use' && b.id === call.id)) continue;
      let input: unknown = call.function?.arguments;
      if (typeof input === 'string') { try { input = JSON.parse(input); } catch { /* keep string */ } }
      blocks.push({ type: 'tool_use', id: call.id, name: call.function?.name || 'tool', input, status: 'running' });
    }
  }

  // Pi format: top-level toolCalls array
  if (Array.isArray(m.toolCalls)) {
    for (const call of m.toolCalls) {
      const id = call.id ?? `tc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      if (blocks.some((b) => b.type === 'tool_use' && b.id === id)) continue;
      blocks.push({ type: 'tool_use', id, name: call.name || 'tool', input: call.args, status: 'running' });
    }
  }

  return blocks;
}

/** Extract plain-text from toolResult content. */
function extractToolResultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((c): c is Record<string, unknown> => c != null && typeof c === 'object' && c.type === 'text')
      .map((c) => String(c.text ?? ''))
      .join('\n');
  }
  return String(content ?? '');
}

/** Apply a toolResult message's result to the last assistant's matching tool_use block. */
function applyToolResultToLastAssistant(out: Message[], m: WireMessage): void {
  let lastAssistant: Message | null = null;
  for (let i = out.length - 1; i >= 0; i--) {
    if (out[i].role === 'assistant') { lastAssistant = out[i]; break; }
  }
  if (!lastAssistant) return;

  const id = String(m.tool_call_id ?? m.toolCallId ?? '');
  const text = extractToolResultText(m.content);
  const isError = Boolean(m.isError);

  // Match by tool_call_id
  if (id) {
    const block = lastAssistant.content.find(
      (b): b is import('../../src/features/chat/messages.types').ToolUseContent =>
        b.type === 'tool_use' && b.id === id,
    );
    if (block) {
      block.status = isError ? 'error' : 'done';
      block.result = text;
      return;
    }
  }

  // Fallback: if exactly one tool is still running, apply to it
  const running = lastAssistant.content.filter(
    (b): b is import('../../src/features/chat/messages.types').ToolUseContent =>
      b.type === 'tool_use' && b.status === 'running',
  );
  if (running.length === 1) {
    running[0].status = isError ? 'error' : 'done';
    running[0].result = text;
  }
}

/** Merge two assistant content arrays: dedupe tool_use by id, dedupe adjacent identical thinking. */
function mergeAssistantContentFragments(left: MessageContent[], right: MessageContent[]): MessageContent[] {
  const out: MessageContent[] = left.map((b) => ({ ...b }));
  const toolIndexById = new Map<string, number>();
  for (let i = 0; i < out.length; i++) {
    const b = out[i];
    if (b.type === 'tool_use') toolIndexById.set(b.id, i);
  }

  for (const b of right) {
    if (b.type === 'tool_use' && toolIndexById.has(b.id)) {
      const idx = toolIndexById.get(b.id)!;
      out[idx] = { ...b }; // keep the later (more complete) version
      continue;
    }
    if (b.type === 'thinking' && out.length > 0) {
      const last = out[out.length - 1];
      if (last.type === 'thinking' && (last.text || '').trim() === (b.text || '').trim()) continue;
    }
    if (b.type === 'tool_use') toolIndexById.set(b.id, out.length);
    out.push({ ...b });
  }
  return out;
}

/** Merge consecutive assistant messages into a single bubble (session stores fragments). */
function mergeConsecutiveAssistantMessages(messages: Message[]): Message[] {
  if (messages.length < 2) return messages;
  const out: Message[] = [];
  for (const m of messages) {
    if (m.role !== 'assistant') { out.push(m); continue; }
    const prev = out[out.length - 1];
    if (prev?.role === 'assistant') {
      prev.content = mergeAssistantContentFragments(prev.content, m.content);
      if (m.timestamp != null) prev.timestamp = m.timestamp;
      if (m.usage) prev.usage = m.usage;
    } else {
      out.push({ ...m, content: [...m.content] });
    }
  }
  return out;
}

function parseTimestamp(raw: string | number | undefined): number | undefined {
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'string') {
    const t = Date.parse(raw);
    return Number.isNaN(t) ? undefined : t;
  }
  return undefined;
}

/**
 * Convert raw session messages (unknown content shape) to typed Message[].
 *
 * Handles toolResult/tool role messages, merges consecutive assistant fragments,
 * and supports OpenAI tool_calls / pi toolCalls formats — matching the web gateway console.
 */
function parseSessionMessages(raw: Array<Record<string, unknown>>): Message[] {
  const out: Message[] = [];

  for (const item of raw) {
    const m = item as unknown as WireMessage;
    const role = String(m.role ?? '');

    // Skip system messages
    if (role === 'system') continue;

    // Tool results → apply to the last assistant's tool_use block
    if (role === 'toolResult' || role === 'tool') {
      applyToolResultToLastAssistant(out, m);
      continue;
    }

    if (role === 'user' || role === 'user-with-attachments') {
      out.push({
        role,
        content: normalizeContentBlocks(m.content),
        timestamp: parseTimestamp(m.timestamp),
      });
      continue;
    }

    if (role === 'assistant') {
      out.push({
        role: 'assistant',
        content: buildAssistantContent(m),
        timestamp: parseTimestamp(m.timestamp),
      });
      continue;
    }

    // Unknown roles → skip (don't render as assistant)
  }

  return mergeConsecutiveAssistantMessages(out);
}

export default function ChatScreen() {
  const { k: rawKey } = useLocalSearchParams<{ k?: string }>();
  const sessionKey = typeof rawKey === 'string' ? rawKey : Array.isArray(rawKey) ? rawKey[0] : '';
  const navigation = useNavigation();
  const router = useRouter();
  const queryClient = useQueryClient();
  const thinking = useGatewayStore((s) => s.thinking);
  const isDark = useColorScheme() === 'dark';
  const insets = useSafeAreaInsets();
  const m = useMessages();

  // ── Agent / model info ───────────────────────────────────
  const agentsQuery = useQuery({
    queryKey: queryKeys.agents,
    queryFn: fetchChatAgents,
  });

  const modelName = useMemo(() => {
    const agents = agentsQuery.data?.items ?? [];
    const defaultId = agentsQuery.data?.defaultId ?? 'main';
    // Extract agentId from session key (format: {agentId}:{source}:{accountId}:{peerKind}:{peerId})
    const sessionAgentId = sessionKey ? sessionKey.split(':')[0]?.trim().toLowerCase() : null;
    const targetId = sessionAgentId || defaultId;
    const agent = agents.find((a) => a.id === targetId);
    return agent?.name ?? agent?.id ?? targetId;
  }, [agentsQuery.data, sessionKey]);

  // ── Session data ─────────────────────────────────────────
  const sessionQuery = useQuery({
    queryKey: queryKeys.session(sessionKey),
    queryFn: () => fetchSession(sessionKey),
    enabled: Boolean(sessionKey),
  });

  const [streamingMsg, setStreamingMsg] = useState<Message | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const senderRef = useRef(new AgentMessageSender());
  const streamingRef = useRef(false);

  /** Optimistic user messages appended before the server responds. */
  const [optimisticMessages, setOptimisticMessages] = useState<Message[]>([]);

  const invalidateSession = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.session(sessionKey) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.sessions });
  }, [queryClient, sessionKey]);

  const sessionName = sessionQuery.data?.name?.trim() || '';
  const [renameVisible, setRenameVisible] = useState(false);
  const [renameLoading, setRenameLoading] = useState(false);
  const [snackMsg, setSnackMsg] = useState('');

  // ── Header: hide default, use custom ─────────────────────
  useLayoutEffect(() => {
    navigation.setOptions({ headerShown: false });
  }, [navigation]);

  const handleRename = useCallback(
    async (name: string) => {
      setRenameLoading(true);
      try {
        await renameSession(sessionKey, name);
        void queryClient.invalidateQueries({ queryKey: queryKeys.session(sessionKey) });
        void queryClient.invalidateQueries({ queryKey: queryKeys.sessions });
        setRenameVisible(false);
      } catch {
        setSnackMsg(m.chat.failedToRename);
      } finally {
        setRenameLoading(false);
      }
    },
    [sessionKey, queryClient],
  );

  /** Parsed messages from the loaded session. */
  const sessionMessages = useMemo<Message[]>(() => {
    const raw = sessionQuery.data?.messages;
    if (!raw || !Array.isArray(raw)) return [];
    return parseSessionMessages(raw);
  }, [sessionQuery.data?.messages]);

  /** Display messages: session history + optimistic user msgs + streaming assistant bubble. */
  const displayMessages = useMemo<Message[]>(() => {
    const base = optimisticMessages.length > 0
      ? [...sessionMessages, ...optimisticMessages]
      : sessionMessages;
    if (!streamingMsg) return base;
    return [...base, streamingMsg];
  }, [sessionMessages, optimisticMessages, streamingMsg]);

  /** Finalize a streaming turn: merge the streamed message into persisted state. */
  const finalizeMessage = useCallback(() => {
    setStreamingMsg(null);
    setStreaming(false);
    streamingRef.current = false;
    setProgress(null);
    setOptimisticMessages([]);
    invalidateSession();
  }, [invalidateSession]);

  function buildCallbacks(): MessagingCallbacks {
    return {
      onStreamStart: () => {
        setStreaming(true);
        streamingRef.current = true;
        setError(null);
        setStreamingMsg((prev) => cloneMessageForRender(ensureAssistantMessage(prev, Date.now())));
      },
      onToken: (delta) => {
        setStreamingMsg((prev) => {
          const msg = ensureAssistantMessage(prev, Date.now());
          appendTextDelta(msg.content, delta);
          return cloneMessageForRender(msg);
        });
        if (!streamingRef.current) {
          setStreaming(true);
          streamingRef.current = true;
        }
      },
      onThinking: (text, isDelta) => {
        setStreamingMsg((prev) => {
          const msg = ensureAssistantMessage(prev, Date.now());
          if (!isDelta && text === '') startThinkingSegment(msg.content);
          else appendThinkingDelta(msg.content, text, isDelta);
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
        if (!streamingRef.current) {
          setStreaming(true);
          streamingRef.current = true;
        }
      },
      onToolEnd: (toolName, isErr, result) => {
        setStreamingMsg((prev) => {
          const msg = ensureAssistantMessage(prev, Date.now());
          completeTool(msg.content, toolName, isErr, result);
          return cloneMessageForRender(msg);
        });
      },
      onProgress: (p) => {
        setProgress(p);
      },
      onResult: () => {
        setStreamingMsg((prev) => {
          if (prev) {
            finalizeStreamingThinking(prev.content);
            finalizeRunningTools(prev.content);
          }
          return prev;
        });
        finalizeMessage();
      },
      onError: (msg) => {
        setStreaming(false);
        streamingRef.current = false;
        setStreamingMsg(null);
        setProgress(null);
        setError(msg);
        invalidateSession();
      },
    };
  }

  const send = useCallback(
    async (text: string) => {
      if (!text.trim() || !sessionKey || streaming) return;
      // Optimistic: show user message immediately
      const userMsg: Message = {
        role: 'user',
        content: [{ type: 'text', text: text.trim() }],
        timestamp: Date.now(),
      };
      setOptimisticMessages([userMsg]);
      setStreamingMsg(null);
      setProgress(null);
      setError(null);
      try {
        await senderRef.current.sendMessage(
          text,
          sessionKey,
          buildCallbacks(),
          thinking.trim() || undefined,
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setStreaming(false);
        streamingRef.current = false;
      }
    },
    [sessionKey, streaming, thinking, finalizeMessage, invalidateSession],
  );

  const abort = useCallback(() => {
    senderRef.current.abort();
    setStreamingMsg((prev) => {
      if (prev) {
        finalizeStreamingThinking(prev.content);
        finalizeRunningTools(prev.content);
      }
      return prev;
    });
    finalizeMessage();
  }, [finalizeMessage]);

  const pendingRunId = useMemo(() => {
    if (!sessionKey) return null;
    try {
      const raw = storage.getString(pendingRunStorageKey(sessionKey));
      if (!raw) return null;
      const p = JSON.parse(raw) as { runId?: string };
      return typeof p.runId === 'string' ? p.runId : null;
    } catch {
      return null;
    }
  }, [sessionKey, streaming]);

  const resume = useCallback(async () => {
    if (!sessionKey || !pendingRunId || streaming) return;
    setStreamingMsg(null);
    setProgress(null);
    try {
      await senderRef.current.resume(
        pendingRunId,
        sessionKey,
        buildCallbacks(),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStreaming(false);
      streamingRef.current = false;
    }
  }, [sessionKey, pendingRunId, streaming, finalizeMessage, invalidateSession]);

  useEffect(() => {
    return () => senderRef.current.abort();
  }, []);

  // ── New chat ─────────────────────────────────────────────
  const handleNewChat = useCallback(() => {
    void createSession(undefined).then((key) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.sessions });
      router.setParams({ k: key });
    });
  }, [queryClient, router]);

  // ── Open drawer ──────────────────────────────────────────
  const openDrawer = useCallback(() => {
    navigation.dispatch(DrawerActions.openDrawer());
  }, [navigation]);

  // ── Header colors ────────────────────────────────────────
  const headerBg = isDark ? '#111827' : '#FFFFFF';
  const headerBorder = isDark ? '#1F2937' : '#E5E7EB';
  const pillBg = isDark ? '#1A2E1E' : '#F1F8E9';
  const pillBorder = isDark ? '#2E7D32' : '#A5D6A7';
  const pillText = isDark ? '#A5D6A7' : '#2E7D32';

  // ── Render: no session key → prompt ──────────────────────
  if (!sessionKey) {
    return (
      <View style={[styles.screen, { backgroundColor: headerBg }]}>
        {/* Header */}
        <View style={[styles.header, { backgroundColor: headerBg, borderBottomColor: headerBorder, paddingTop: insets.top + 8 }]}>
          <View style={styles.headerLeft}>
            <IconButton icon="menu" size={22} onPress={openDrawer} />
            <IconButton icon="plus" size={22} onPress={handleNewChat} />
          </View>
          <Pressable style={[styles.modelPill, { backgroundColor: pillBg, borderColor: pillBorder }]}>
            <Text style={[styles.modelPillText, { color: pillText }]} numberOfLines={1}>
              {modelName}
            </Text>
            <Icon source="chevron-down" size={16} color={pillText} />
          </Pressable>
          <View style={styles.headerRight}>
            <IconButton icon="calendar-outline" size={22} onPress={() => {}} />
          </View>
        </View>
        <View style={styles.emptyContainer}>
          <Text variant="bodyLarge" style={{ opacity: 0.6 }}>{m.sessions.empty}</Text>
          <Text variant="bodySmall" style={{ opacity: 0.4, marginTop: 8 }}>{m.sessions.emptyHint}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: headerBg }]}>
      {/* ── Custom header ────────────────────────────── */}
      <View style={[styles.header, { backgroundColor: headerBg, borderBottomColor: headerBorder, paddingTop: insets.top + 8 }]}>
        <View style={styles.headerLeft}>
          <IconButton icon="menu" size={22} onPress={openDrawer} />
          <IconButton icon="plus" size={22} onPress={handleNewChat} />
        </View>
        <Pressable style={[styles.modelPill, { backgroundColor: pillBg, borderColor: pillBorder }]}>
          <Text style={[styles.modelPillText, { color: pillText }]} numberOfLines={1}>
            {modelName}
          </Text>
          <Icon source="chevron-down" size={16} color={pillText} />
        </Pressable>
        <View style={styles.headerRight}>
          <IconButton icon="calendar-outline" size={22} onPress={() => setRenameVisible(true)} />
        </View>
      </View>

      {/* ── Chat body ────────────────────────────────── */}
      <KeyboardAvoidingView
        style={styles.chatBody}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        {error ? (
          <Banner visible icon="alert" actions={[{ label: m.chat.dismiss, onPress: () => setError(null) }]}>
            {error}
          </Banner>
        ) : null}
        {pendingRunId && !streaming ? (
          <Banner
            visible
            icon="sync"
            actions={[{ label: m.chat.resumeButton, onPress: () => void resume() }]}
          >
            {m.chat.resumeBanner}
          </Banner>
        ) : null}

        <MessageList
          messages={displayMessages}
          streaming={streaming}
          progress={progress}
          loading={sessionQuery.isLoading}
          sessionKey={sessionKey}
        />

        <ChatComposer
          disabled={sessionQuery.isLoading}
          streaming={streaming}
          onSend={(text) => void send(text)}
          onAbort={abort}
        />
      </KeyboardAvoidingView>

      {/* ── Dialogs ──────────────────────────────────── */}
      <RenameDialog
        visible={renameVisible}
        currentName={sessionName}
        onDismiss={() => setRenameVisible(false)}
        onRename={(name) => void handleRename(name)}
        loading={renameLoading}
      />

      <Snackbar
        visible={Boolean(snackMsg)}
        onDismiss={() => setSnackMsg('')}
        duration={2500}
      >
        {snackMsg}
      </Snackbar>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  // ── Header ──
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    // paddingTop is set dynamically via useSafeAreaInsets() — see inline style
    paddingBottom: 8,
    paddingHorizontal: 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  modelPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
    gap: 4,
    maxWidth: 220,
  },
  modelPillText: {
    fontSize: 13,
    fontWeight: '600',
    flexShrink: 1,
  },
  // ── Chat body ──
  chatBody: {
    flex: 1,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
});
