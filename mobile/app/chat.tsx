import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useNavigation } from 'expo-router';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, View } from 'react-native';
import {
  ActivityIndicator,
  Banner,
  IconButton,
  Text,
  TextInput as PaperTextInput,
} from 'react-native-paper';

import { AgentMessageSender, type MessagingCallbacks } from '../src/api/agent-client';
import { messageContentToString } from '../src/lib/message-text';
import { queryKeys } from '../src/query/keys';
import { fetchSession } from '../src/query/sessions';
import { pendingRunStorageKey, storage } from '../src/storage/mmkv';
import { useGatewayStore } from '../src/stores/gateway-store';

function noop() {}

function buildCallbacks(
  appendToken: (d: string) => void,
  setStreaming: (v: boolean) => void,
  setError: (e: string | null) => void,
  onDone: () => void,
): MessagingCallbacks {
  return {
    onStreamStart: () => {
      setStreaming(true);
      setError(null);
    },
    onToken: (delta) => appendToken(delta),
    onThinking: noop,
    onThinkingEnd: noop,
    onToolStart: noop,
    onToolEnd: noop,
    onProgress: noop,
    onResult: () => {
      setStreaming(false);
      onDone();
    },
    onError: (msg) => {
      setStreaming(false);
      setError(msg);
      onDone();
    },
  };
}

export default function ChatScreen() {
  const { k: rawKey } = useLocalSearchParams<{ k?: string }>();
  const sessionKey = typeof rawKey === 'string' ? rawKey : Array.isArray(rawKey) ? rawKey[0] : '';
  const navigation = useNavigation();
  const queryClient = useQueryClient();
  const thinking = useGatewayStore((s) => s.thinking);

  const sessionQuery = useQuery({
    queryKey: queryKeys.session(sessionKey),
    queryFn: () => fetchSession(sessionKey),
    enabled: Boolean(sessionKey),
  });

  const [draft, setDraft] = useState('');
  const [streamingText, setStreamingText] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const senderRef = useRef(new AgentMessageSender());

  const invalidateSession = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.session(sessionKey) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.sessions });
  }, [queryClient, sessionKey]);

  useLayoutEffect(() => {
    navigation.setOptions({
      title: sessionKey ? sessionKey.slice(-28) : 'Chat',
    });
  }, [navigation, sessionKey]);

  const listData = useMemo(() => {
    const msgs = sessionQuery.data?.messages ?? [];
    const rows: { id: string; role: string; text: string }[] = [];
    let i = 0;
    for (const m of msgs) {
      rows.push({
        id: `m-${i++}`,
        role: m.role,
        text: messageContentToString(m.content),
      });
    }
    if (streaming && streamingText) {
      rows.push({ id: 'stream', role: 'assistant', text: streamingText });
    }
    return rows;
  }, [sessionQuery.data?.messages, streaming, streamingText]);

  const send = async () => {
    const text = draft.trim();
    if (!text || !sessionKey || streaming) return;
    setDraft('');
    setStreamingText('');
    const sender = senderRef.current;
    let buf = '';
    const appendToken = (d: string) => {
      buf += d;
      setStreamingText(buf);
    };
    try {
      await sender.sendMessage(
        text,
        sessionKey,
        buildCallbacks(appendToken, setStreaming, setError, invalidateSession),
        thinking.trim() || undefined,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStreaming(false);
    }
  };

  const abort = () => {
    senderRef.current.abort();
    setStreaming(false);
    invalidateSession();
  };

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

  const resume = async () => {
    if (!sessionKey || !pendingRunId || streaming) return;
    setStreamingText('');
    const sender = senderRef.current;
    let buf = '';
    const appendToken = (d: string) => {
      buf += d;
      setStreamingText(buf);
    };
    try {
      await sender.resume(
        pendingRunId,
        sessionKey,
        buildCallbacks(appendToken, setStreaming, setError, invalidateSession),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStreaming(false);
    }
  };

  useEffect(() => {
    return () => senderRef.current.abort();
  }, []);

  if (!sessionKey) {
    return (
      <View style={{ flex: 1, padding: 16 }}>
        <Text>Missing session key.</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={72}
    >
      {error ? (
        <Banner visible icon="alert" actions={[{ label: 'Dismiss', onPress: () => setError(null) }]}>
          {error}
        </Banner>
      ) : null}
      {pendingRunId && !streaming ? (
        <Banner
          visible
          icon="sync"
          actions={[{ label: 'Resume stream', onPress: () => void resume() }]}
        >
          An in-flight run may still be active. Tap resume to reattach SSE.
        </Banner>
      ) : null}
      {sessionQuery.isLoading ? (
        <ActivityIndicator style={{ marginTop: 24 }} />
      ) : (
        <FlatList
          data={listData}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 12 }}
          renderItem={({ item }) => (
            <View style={{ marginBottom: 12 }}>
              <Text variant="labelSmall" style={{ opacity: 0.6 }}>
                {item.role}
              </Text>
              <Text selectable>{item.text || ' '}</Text>
            </View>
          )}
        />
      )}
      <View style={{ flexDirection: 'row', alignItems: 'center', padding: 8, gap: 4 }}>
        <PaperTextInput
          style={{ flex: 1 }}
          mode="outlined"
          placeholder="Message"
          value={draft}
          onChangeText={setDraft}
          multiline
          disabled={streaming}
          onSubmitEditing={() => void send()}
        />
        {streaming ? (
          <IconButton icon="stop" mode="contained-tonal" onPress={abort} />
        ) : (
          <IconButton icon="send" mode="contained" onPress={() => void send()} disabled={!draft.trim()} />
        )}
      </View>
    </KeyboardAvoidingView>
  );
}
