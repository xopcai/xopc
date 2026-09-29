import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { Button, Icon, Text } from 'react-native-paper';

import { BottomSheetModal } from '../../components/BottomSheetModal';
import { useMessages } from '../../i18n/messages';
import { cancelSessionInput, fetchSessionInputs, queuedMessages, sessionInputsKey, updateSessionInput, type SessionInput } from '../../query/session-inputs';
import { useGatewayStore } from '../../stores/gateway-store';
import { spacing, typography, useTheme } from '../../theme';
import { acknowledgeLocalSessionInputs, localMessageScope, useLocalMessagesStore } from './local-messages-store';
import { subscribeGatewayEvent } from '../gateway/gateway-event-bus';
import { retrySessionPreparation } from '../../query/session-inputs';

export function ChatQueueTray({ conversationId, onEdit }: { conversationId: string; onEdit: (input: SessionInput) => void }) {
  const gatewayId = useGatewayStore(s => s.activeGatewayId);
  const m = useMessages().mobileExperience;
  const { colors } = useTheme();
  const client = useQueryClient();
  const key = sessionInputsKey(gatewayId, conversationId);
  const state = useQuery({ queryKey: key, queryFn: () => fetchSessionInputs(conversationId), enabled: Boolean(gatewayId && conversationId), refetchInterval: 15_000 });
  useEffect(() => {
    if (state.data) useLocalMessagesStore.getState().update(localMessageScope(gatewayId, conversationId, useGatewayStore.getState().getActiveProfile()?.deviceId ?? null), messages => acknowledgeLocalSessionInputs(messages, state.data.inputs));
  }, [conversationId, gatewayId, state.data]);
  const [visible, setVisible] = useState(false);
  useEffect(() => subscribeGatewayEvent('session.input-state', detail => {
    if (detail && typeof detail === 'object' && 'conversationId' in detail && detail.conversationId === conversationId) {
      void client.invalidateQueries({ queryKey: sessionInputsKey(gatewayId, conversationId) });
    }
  }), [client, gatewayId, conversationId]);
  const mutation = useMutation({
    mutationFn: ({ input, position }: { input: SessionInput; position?: number }) => position === undefined
      ? cancelSessionInput(conversationId, input)
      : updateSessionInput(conversationId, input, { position }),
    onSuccess: result => { client.setQueryData(key, result); },
    onSettled: () => { void client.invalidateQueries({ queryKey: key }); },
  });
  const queue = queuedMessages(state.data);
  const preparation = state.data?.preparation;
  const retryPreparation = useMutation({
    mutationFn: () => preparation ? retrySessionPreparation(conversationId, preparation) : Promise.resolve(),
    onSettled: () => { void client.invalidateQueries({ queryKey: key }); },
  });
  if (!queue.length && !visible && !state.isError) return null;
  return <>
    <Pressable accessibilityRole="button" onPress={() => { setVisible(true); void state.refetch(); }} style={styles.trigger}>
      <Icon source="playlist-edit" size={18} color={colors.text.secondary} />
      <Text style={{ color: colors.text.secondary }}>{state.isError ? m.queueSyncFailed : `${m.queue} · ${queue.length}`}</Text>
      <Icon source="chevron-up" size={18} color={colors.text.secondary} />
    </Pressable>
    <BottomSheetModal visible={visible} onDismiss={() => { setVisible(false); mutation.reset(); }} title={m.queue} subtitle={m.queuedExplain} keyboardAvoiding>
      <View style={styles.content}>
        {preparation && preparation.state !== 'ready' ? <View>
          <Text>{preparation.state === 'preparing' ? m.sessionPreparing : preparation.lastError ?? m.sessionPreparationFailed}</Text>
          {preparation.state === 'preparation_failed' ? <Button disabled={retryPreparation.isPending} onPress={() => retryPreparation.mutate()}>{m.retry}</Button> : null}
          {retryPreparation.isError ? <Text accessibilityRole="alert">{retryPreparation.error.message}</Text> : null}
        </View> : null}
        {state.isError ? <Button onPress={() => void state.refetch()}>{m.retry}</Button> : !queue.length ? <Text style={{ color: colors.text.secondary }}>{m.queueEmpty}</Text> : null}
        {mutation.isError ? <Text accessibilityRole="alert" style={{ color: colors.semantic.error }}>{m.queueError}</Text> : null}
        {queue.map((input, index) => {
          const image = input.attachments?.find(attachment => attachment.mimeType?.startsWith('image/'));
          const imageUri = image?.data ? `data:${image.mimeType ?? 'image/jpeg'};base64,${image.data}` : image?.uri;
          return <View key={input.id} style={[styles.row, { borderBottomColor: colors.border.subtle }]}>
            <View style={styles.previewRow}>
              {imageUri ? <Image source={{ uri: imageUri }} style={styles.thumbnail} resizeMode="cover" /> : input.attachments?.length ? <Icon source="paperclip" size={22} color={colors.text.secondary} /> : null}
              <View style={styles.previewText}>
                <Text numberOfLines={2} style={[typography.body, { color: colors.text.primary }]}>{input.content || m.attachedContent}</Text>
                {input.attachments?.length || input.contextRefs?.length ? <Text style={{ color: colors.text.secondary }}>
                  {[input.attachments?.length ? `📎 ${input.attachments.length}` : '', input.contextRefs?.length ? `@ ${input.contextRefs.length}` : ''].filter(Boolean).join(' · ')}
                </Text> : null}
              </View>
            </View>
            <View style={styles.actions}>
              <Button compact disabled={mutation.isPending || index === 0} onPress={() => mutation.mutate({ input, position: index - 1 })}>↑</Button>
              <Button compact disabled={mutation.isPending || index === queue.length - 1} onPress={() => mutation.mutate({ input, position: index + 1 })}>↓</Button>
              <Button disabled={mutation.isPending} onPress={() => { setVisible(false); onEdit(input); }}>{m.edit}</Button>
              <Button disabled={mutation.isPending} onPress={() => mutation.mutate({ input })}>{m.cancel}</Button>
            </View>
          </View>;
        })}
      </View>
    </BottomSheetModal>
  </>;
}
const styles = StyleSheet.create({ trigger: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm }, content: { paddingHorizontal: spacing.lg }, row: { paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth }, previewRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm }, previewText: { flex: 1 }, thumbnail: { width: 48, height: 48, borderRadius: 10 }, actions: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center' } });
