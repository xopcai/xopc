import { useEffect, useState } from 'react';
import { AppState, DeviceEventEmitter, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Button, Icon, Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { submitClarifyResponse } from '../../api/agent-client';
import { ClarifyPrompt } from '../chat/ClarifyPrompt';
import { MarkdownView } from '../chat/MarkdownView';
import { useMessages } from '../../i18n/messages';
import { useGatewayStore } from '../../stores/gateway-store';
import { useTheme, spacing, typography } from '../../theme';
import { setCallSpeaker, useVoiceCall, voiceCall } from './voice-call';
import { voiceApprovalsOptions, respondVoiceApproval } from '../../query/voice';
import { useVoicePreferences } from './voice-preferences';
import { voiceErrorMessage } from './voice-error';

export function VoiceCallSurface() {
  const state = useVoiceCall();
  const { voice: m } = useMessages();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const captions = useVoicePreferences(s => s.captions);
  const [speaker, setSpeaker] = useState(false);
  const [, tick] = useState(0);
  const approvals = useQuery({ ...voiceApprovalsOptions(state.target?.gatewayId, state.target?.sessionKey), enabled: state.phase === 'connected' && state.engine === 'agent' });
  const pendingApprovals = state.phase === 'connected' && state.engine === 'agent' ? approvals.data ?? [] : [];
  const approval = useMutation({ mutationFn: ({ id, decision }: { id: string; decision: 'approved' | 'denied' }) => respondVoiceApproval(id, decision), onSuccess: () => approvals.refetch(), retry: false });
  useEffect(() => { voiceCall.setApprovalPending(pendingApprovals.length > 0); }, [pendingApprovals.length]);
  const clarification = useMutation({
    mutationFn: ({ id, answer }: { id: string; answer?: string }) => submitClarifyResponse(id, answer === undefined ? { skip: true } : { answer }),
    onSuccess: (_, variables) => { if (voiceCall.getSnapshot().clarification?.requestId === variables.id) voiceCall.confirmationSent(); },
    retry: false,
  });
  useEffect(() => {
    const consent = DeviceEventEmitter.addListener('voice-consent-revoked', () => void voiceCall.end());
    const app = AppState.addEventListener('change', status => {
      const current = voiceCall.getSnapshot();
      if (status === 'background' && !current.target?.background && current.phase !== 'idle') void voiceCall.pause('background');
    });
    const gateway = useGatewayStore.subscribe((next, previous) => {
      if (next.activeGatewayId !== previous.activeGatewayId || next.unauthorized) void voiceCall.end();
    });
    return () => { consent.remove(); app.remove(); gateway(); void voiceCall.end(); };
  }, []);
  useEffect(() => {
    if (state.phase === 'connecting' || state.phase === 'recovering') setSpeaker(false);
    if (state.phase === 'idle') return;
    const interval = setInterval(() => tick(x => x + 1), 1000);
    return () => clearInterval(interval);
  }, [state.phase]);
  if (state.phase === 'idle') return null;
  const status = state.phase === 'connected'
    ? (state.clarification || pendingApprovals.length > 0) ? m.waiting : state.activity ? m.working : state.responseId ? m.replying : m.connected
    : m[state.phase];
  const muted = state.muted ? m.muted : status;
  const elapsed = Math.max(0, Math.floor((Date.now() - state.startedAt) / 1000));
  const openSettings = () => { voiceCall.expand(false); router.push('/settings/voice'); };
  const showChat = () => {
    voiceCall.expand(false);
    if (state.target) router.push(`/chat/${encodeURIComponent(state.target.sessionKey)}`);
  };
  return <>
    {!state.expanded && <View style={[styles.bar, { backgroundColor: colors.surface.panel, borderColor: colors.border.default, paddingBottom: Math.max(insets.bottom, spacing.sm) }]}>
      <Pressable style={styles.grow} accessibilityRole="button" accessibilityLabel={m.expand} onPress={() => voiceCall.expand()}>
        <Text>{state.name || m.title}</Text><Text>{muted}</Text>
      </Pressable>
      <Button onPress={() => void voiceCall.end()} textColor={colors.semantic.error}>{m.end}</Button>
    </View>}
    <Modal visible={state.expanded} animationType="slide" onRequestClose={() => voiceCall.expand(false)}>
      <View style={[styles.screen, { backgroundColor: colors.surface.base, paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={styles.row}>
          <Button onPress={() => voiceCall.expand(false)}>{m.minimize}</Button>
          <Text style={[styles.grow, typography.heading]} numberOfLines={1}>{state.name || m.title}</Text>
          <Button onPress={openSettings}>{m.settings}</Button>
        </View>
        <ScrollView style={styles.grow} contentContainerStyle={styles.content}>
          <Text>{state.engine === 'omni' ? m.chatOnly : state.engine === 'agent' ? m.tools : m.mode}</Text>
          <Icon source="waveform" size={64} color={colors.accent.primary} />
          <Text accessibilityLiveRegion="polite" style={typography.title}>{status}</Text>
          {state.muted && <Text>{m.muted}</Text>}
          <Text>{Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}</Text>
          {state.phase === 'connected' && state.expiresAt && state.expiresAt - Date.now() < 60_000 && <Text accessibilityLiveRegion="polite">{m.endingSoon}</Text>}
          {state.error && <Text accessibilityRole="alert">{voiceErrorMessage(state.error, m)}</Text>}
          {state.phase === 'paused' && <Button mode="contained" onPress={() => void voiceCall.resume()}>{m.resume}</Button>}
          {captions && <View style={styles.transcript}>
            <Text style={{ color: colors.text.secondary }}>{state.userText}</Text>
            <MarkdownView content={state.assistantText} />
          </View>}
          {state.responseId && <Button onPress={() => void voiceCall.stopReply()}>{m.stopReply}</Button>}
          <ClarifyPrompt prompt={state.clarification ?? null} submitting={clarification.isPending} submitError={clarification.isError ? m.error : null}
            onSubmit={answer => { if (state.clarification) clarification.mutate({ id: state.clarification.requestId, answer }); }}
            onSkip={() => { if (state.clarification) clarification.mutate({ id: state.clarification.requestId }); }} />
          {pendingApprovals.map(item => <View key={item.id} style={styles.transcript}>
            <Text style={typography.heading}>{m.approval}</Text>
            <Text>{item.actionId}</Text>
            <Text selectable>{JSON.stringify(item.argumentsPreview, null, 2)}</Text>
            <View style={styles.row}>
              <Button disabled={approval.isPending} onPress={() => approval.mutate({ id: item.id, decision: 'denied' })}>{m.deny}</Button>
              <Button disabled={approval.isPending} onPress={() => approval.mutate({ id: item.id, decision: 'approved' })}>{m.approve}</Button>
            </View>
          </View>)}
          {(approval.isError || approvals.isError) && <Text>{m.approvalError}</Text>}
          <Button onPress={showChat}>{m.returnChat}</Button>
        </ScrollView>
        <View style={styles.controls}>
          <Button icon={state.muted ? 'microphone-off' : 'microphone'} disabled={state.phase === 'ending'} onPress={() => void voiceCall.setMuted(!state.muted)}>{state.muted ? m.unmute : m.mute}</Button>
          <Button icon="volume-high" disabled={state.phase !== 'connected'} onPress={() => {
            void setCallSpeaker(!speaker).then(() => setSpeaker(!speaker)).catch(() => voiceCall.pause('route_lost'));
          }}>{speaker ? m.speaker : m.systemOutput}</Button>
          <Button icon="phone-hangup" textColor={colors.semantic.error} onPress={() => void voiceCall.end()}>{m.end}</Button>
        </View>
      </View>
    </Modal>
  </>;
}
const styles = StyleSheet.create({
  screen: { flex: 1 }, grow: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', padding: spacing.sm },
  bar: { flexDirection: 'row', alignItems: 'center', padding: spacing.md, borderTopWidth: StyleSheet.hairlineWidth },
  content: { padding: spacing.lg, gap: spacing.lg, alignItems: 'center' },
  transcript: { alignSelf: 'stretch', gap: spacing.md },
  controls: { padding: spacing.sm, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center' },
});
