import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Button, Icon, Text } from 'react-native-paper';

import { BottomSheetModal } from '../../components/BottomSheetModal';
import { useMessages } from '../../i18n/messages';
import { cancelSessionInput, fetchSessionInputs, queuedMessages, sessionInputsKey, updateSessionInput, type SessionInput } from '../../query/session-inputs';
import { useGatewayStore } from '../../stores/gateway-store';
import { spacing, typography, useTheme } from '../../theme';
import { acknowledgeLocalSessionInputs, localMessageScope, useLocalMessagesStore } from './local-messages-store';
import { subscribeGatewayEvent } from '../gateway/gateway-event-bus';

export function ChatQueueTray({ conversationId }: { conversationId: string }) {
  const gatewayId = useGatewayStore(s => s.activeGatewayId);
  const m = useMessages().mobileExperience;
  const { colors } = useTheme();
  const client = useQueryClient();
  const key = sessionInputsKey(gatewayId, conversationId);
  const state = useQuery({ queryKey: key, queryFn: () => fetchSessionInputs(conversationId), enabled: Boolean(gatewayId && conversationId), refetchInterval: 15_000 });
  useEffect(() => {
    if (state.data) useLocalMessagesStore.getState().update(localMessageScope(gatewayId, conversationId), messages => acknowledgeLocalSessionInputs(messages, state.data.inputs));
  }, [conversationId, gatewayId, state.data]);
  const [visible, setVisible] = useState(false);
  const [editing, setEditing] = useState<SessionInput | null>(null);
  const [draft, setDraft] = useState('');
  useEffect(() => subscribeGatewayEvent('session.input-state', detail => {
    if (detail && typeof detail === 'object' && 'conversationId' in detail && detail.conversationId === conversationId) {
      void client.invalidateQueries({ queryKey: sessionInputsKey(gatewayId, conversationId) });
    }
  }), [client, gatewayId, conversationId]);
  const mutation = useMutation({
    mutationFn: ({ input, content }: { input: SessionInput; content?: string }) => content === undefined ? cancelSessionInput(conversationId, input) : updateSessionInput(conversationId, input, content),
    onSuccess: result => { client.setQueryData(key, result); setEditing(null); },
    onError: () => setEditing(null),
    onSettled: () => { void client.invalidateQueries({ queryKey: key }); },
  });
  const queue = queuedMessages(state.data);
  if (!queue.length && !visible && !state.isError) return null;
  return <>
    <Pressable accessibilityRole="button" onPress={() => { setVisible(true); void state.refetch(); }} style={styles.trigger}>
      <Icon source="playlist-edit" size={18} color={colors.text.secondary} />
      <Text style={{ color: colors.text.secondary }}>{state.isError ? m.queueSyncFailed : `${m.queue} · ${queue.length}`}</Text>
      <Icon source="chevron-up" size={18} color={colors.text.secondary} />
    </Pressable>
    <BottomSheetModal visible={visible} onDismiss={() => { setVisible(false); setEditing(null); mutation.reset(); }} title={m.queue} subtitle={m.queuedExplain} keyboardAvoiding>
      <View style={styles.content}>
        {state.isError ? <Button onPress={() => void state.refetch()}>{m.retry}</Button> : !queue.length ? <Text style={{ color: colors.text.secondary }}>{m.queueEmpty}</Text> : null}
        {mutation.isError ? <Text accessibilityRole="alert" style={{ color: colors.semantic.error }}>{m.queueError}</Text> : null}
        {queue.map(input => <View key={input.id} style={[styles.row, { borderBottomColor: colors.border.subtle }]}>
          {editing?.id === input.id ? <>
            <TextInput accessibilityLabel={m.edit} multiline value={draft} onChangeText={setDraft} style={[styles.editor, { color: colors.text.primary, borderColor: colors.border.default }]} />
            <View style={styles.actions}><Button disabled={mutation.isPending} onPress={() => setEditing(null)}>{m.cancel}</Button><Button disabled={mutation.isPending || !draft.trim()} onPress={() => mutation.mutate({ input: editing, content: draft })}>{m.save}</Button></View>
          </> : <>
            <Text style={[typography.body, { color: colors.text.primary }]}>{input.content || m.attachedContent}</Text>
            <View style={styles.actions}><Button disabled={mutation.isPending} onPress={() => { setEditing(input); setDraft(input.content); mutation.reset(); }}>{m.edit}</Button><Button disabled={mutation.isPending} onPress={() => mutation.mutate({ input })}>{m.cancel}</Button></View>
          </>}
        </View>)}
      </View>
    </BottomSheetModal>
  </>;
}
const styles = StyleSheet.create({ trigger: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm }, content: { paddingHorizontal: spacing.lg }, row: { paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth }, actions: { flexDirection: 'row', justifyContent: 'flex-end' }, editor: { ...typography.body, minHeight: 100, borderWidth: 1, borderRadius: 12, padding: spacing.md } });
