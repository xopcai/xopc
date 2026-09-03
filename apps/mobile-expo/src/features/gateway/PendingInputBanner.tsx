import { useMutation } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Button, Text } from 'react-native-paper';

import { AgentMessageSender } from '../../api/agent-client';
import { useMessages } from '../../i18n/messages';
import { fetchSession } from '../../query/sessions';
import { storage } from '../../storage/mmkv';
import { useGatewayStore } from '../../stores/gateway-store';
import { spacing, typography, useTheme } from '../../theme';
import { releaseOutboxAttachments } from './outbox-attachments';
import { subscribeGatewayEvent } from './gateway-event-bus';
import { OUTBOX_CHANGED, completeSessionInput, readLegacySessionInput, readPendingSessionInput, updatePendingSessionInput } from './session-input-outbox';

export function PendingInputBanner({ sessionKey }: { sessionKey: string }) {
  const gatewayId = useGatewayStore(s => s.activeGatewayId);
  const f = useMessages().gatewayConnect.flow;
  const { colors } = useTheme();
  const [, refresh] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => subscribeGatewayEvent(OUTBOX_CHANGED, () => refresh(n => n + 1)), []);
  const pending = readPendingSessionInput(sessionKey);
  const legacy = readLegacySessionInput(sessionKey);
  const entry = pending ?? legacy;
  const retry = useMutation({
    mutationFn: async () => {
      if (!pending) return;
      const session = await fetchSession(sessionKey);
      if (useGatewayStore.getState().activeGatewayId !== gatewayId) return;
      if (!session?.sessionId || (pending.expectedSessionId && session.sessionId !== pending.expectedSessionId)) throw new Error('SESSION_CHANGED');
      const ready = updatePendingSessionInput(pending, { expectedSessionId: session.sessionId, needsReview: false, createdAt: Date.now() });
      try { await new AgentMessageSender().flushPendingMessage(sessionKey); }
      catch (error) { updatePendingSessionInput(ready, { needsReview: true }); throw error; }
    },
  });
  if (!entry) return null;
  const review = !pending || pending.needsReview;
  return <View style={{ paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, backgroundColor: colors.surface.input }}>
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <Text style={[typography.caption, { flex: 1, color: colors.text.secondary }]}>{review ? f.reviewInput : f.queuedInput}</Text>
      <Button compact onPress={() => setExpanded(v => !v)}>{f.inspect}</Button>
    </View>
    {expanded ? <>
      <Text selectable numberOfLines={5} style={typography.body}>{entry.content}</Text>
      {entry.attachments.length ? <Text style={typography.caption}>{entry.attachments.map(a => a.name ?? a.type).join(' · ')}</Text> : null}
      {retry.isError ? <Text style={{ color: colors.semantic.errorBold }}>{f.retryInputFailed}</Text> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {pending ? <Button disabled={retry.isPending} loading={retry.isPending} onPress={() => retry.mutate()}>{f.retryInput}</Button> : null}
        <Button onPress={() => void Clipboard.setStringAsync(entry.content).then(() => setCopied(true))}>{copied ? f.copied : f.copyInput}</Button>
        <Button disabled={retry.isPending} onPress={() => {
          if (pending) { completeSessionInput(sessionKey, pending.clientMessageId); releaseOutboxAttachments(pending.clientMessageId); }
          else storage.delete(`session-input-outbox:${sessionKey}`);
          refresh(n => n + 1);
        }}>{f.removeInput}</Button>
      </View>
      <Text style={[typography.caption, { color: colors.text.secondary }]}>{f.removeInputHint}</Text>
    </> : null}
  </View>;
}
