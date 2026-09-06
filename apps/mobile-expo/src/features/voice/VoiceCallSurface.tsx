import { useEffect, useState } from 'react';
import { AppState, DeviceEventEmitter, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Button, Icon, Portal, Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { submitClarifyResponse } from '../../api/agent-client';
import { ClarifyPrompt } from '../chat/ClarifyPrompt';
import { MarkdownView } from '../chat/MarkdownView';
import { useMessages } from '../../i18n/messages';
import { useGatewayStore } from '../../stores/gateway-store';
import { radii, useTheme, spacing, typography } from '../../theme';
import { setCallSpeaker, useVoiceCall, voiceCall } from './voice-call';
import { voiceApprovalsOptions, respondVoiceApproval } from '../../query/voice';
import { useVoicePreferences } from './voice-preferences';
import { voiceErrorMessage } from './voice-error';

function approvalValue(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) return value.map(approvalValue).filter(Boolean).join(', ');
  if (typeof value === 'object') {
    return Object.values(value).map(approvalValue).filter(Boolean).join(', ');
  }
  return '';
}

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
    {!state.expanded && <Portal>
      <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
        <View style={[styles.miniBar, { top: insets.top + spacing.sm, backgroundColor: colors.surface.panel, borderColor: colors.border.default }]}>
          <Pressable style={styles.miniBody} accessibilityRole="button" accessibilityLabel={m.expand} onPress={() => voiceCall.expand()}>
            <View style={[styles.miniIcon, { backgroundColor: colors.accent.selectionBg }]}>
              <Icon source="waveform" size={20} color={colors.accent.primary} />
            </View>
            <View style={styles.grow}>
              <Text numberOfLines={1} style={[typography.label, { color: colors.text.primary }]}>{state.name || m.title}</Text>
              <Text numberOfLines={1} style={[typography.caption, { color: colors.text.secondary }]}>{muted}</Text>
            </View>
          </Pressable>
          <Pressable style={[styles.miniEnd, { backgroundColor: colors.semantic.error }]} accessibilityRole="button" accessibilityLabel={m.end} onPress={() => void voiceCall.end()}>
            <Icon source="phone-hangup" size={20} color={colors.text.inverse} />
          </Pressable>
        </View>
      </View>
    </Portal>}
    <Modal visible={state.expanded} animationType="slide" onRequestClose={() => voiceCall.expand(false)}>
      <View style={[styles.screen, { backgroundColor: colors.surface.base, paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={styles.header}>
          <Pressable style={styles.headerButton} accessibilityRole="button" accessibilityLabel={m.minimize} onPress={() => voiceCall.expand(false)}>
            <Icon source="chevron-down" size={26} color={colors.text.primary} />
          </Pressable>
          <Text style={[styles.headerTitle, typography.heading, { color: colors.text.primary }]} numberOfLines={1}>{state.name || m.title}</Text>
          <Pressable style={styles.headerButton} accessibilityRole="button" accessibilityLabel={m.settings} onPress={openSettings}>
            <Icon source="cog-outline" size={23} color={colors.text.primary} />
          </Pressable>
        </View>
        <ScrollView style={styles.grow} contentContainerStyle={styles.content}>
          <View style={[styles.voiceOrb, { backgroundColor: colors.accent.selectionBg }]}>
            <Icon source="waveform" size={72} color={colors.accent.primary} />
          </View>
          <Text accessibilityLiveRegion="polite" style={[typography.title, { color: colors.text.primary }]}>{status}</Text>
          <Text style={[styles.elapsed, { color: colors.text.secondary }]}>{Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}</Text>
          {state.phase === 'connected' && state.expiresAt && state.expiresAt - Date.now() < 60_000 && <Text accessibilityLiveRegion="polite" style={{ color: colors.text.secondary }}>{m.endingSoon}</Text>}
          {state.error && <Text accessibilityRole="alert" style={{ color: colors.semantic.error }}>{voiceErrorMessage(state.error, m)}</Text>}
          {state.phase === 'paused' && <Button mode="contained" onPress={() => void voiceCall.resume()}>{m.resume}</Button>}
          {captions && (state.userText || state.assistantText) && <View style={[styles.card, { backgroundColor: colors.surface.panel, borderColor: colors.border.subtle }]}>
            {state.userText ? <Text style={{ color: colors.text.secondary }}>{state.userText}</Text> : null}
            <MarkdownView content={state.assistantText} />
          </View>}
          {state.responseId && <Button mode="outlined" onPress={() => void voiceCall.stopReply()}>{m.stopReply}</Button>}
          {state.clarification ? <View style={[styles.card, { backgroundColor: colors.surface.panel, borderColor: colors.border.subtle }]}>
            <ClarifyPrompt prompt={state.clarification} submitting={clarification.isPending} submitError={clarification.isError ? m.error : null}
              onSubmit={answer => { if (state.clarification) clarification.mutate({ id: state.clarification.requestId, answer }); }}
              onSkip={() => { if (state.clarification) clarification.mutate({ id: state.clarification.requestId }); }} />
          </View> : null}
          {pendingApprovals.map(item => <View key={item.id} style={[styles.card, { backgroundColor: colors.surface.panel, borderColor: colors.border.subtle }]}>
            <Text style={[typography.heading, { color: colors.text.primary }]}>{m.approval}</Text>
            <Text style={{ color: colors.text.primary }}>{item.actionId}</Text>
            {Object.entries(item.argumentsPreview).map(([key, value]) => {
              const summary = approvalValue(value);
              return summary ? <Text key={key} style={{ color: colors.text.secondary }}>{key}: {summary}</Text> : null;
            })}
            <View style={styles.row}>
              <Button disabled={approval.isPending} onPress={() => approval.mutate({ id: item.id, decision: 'denied' })}>{m.deny}</Button>
              <Button disabled={approval.isPending} onPress={() => approval.mutate({ id: item.id, decision: 'approved' })}>{m.approve}</Button>
            </View>
          </View>)}
          {(approval.isError || approvals.isError) && <Text>{m.approvalError}</Text>}
          <Button onPress={showChat}>{m.returnChat}</Button>
        </ScrollView>
        <View style={styles.controls}>
          <Pressable disabled={state.phase === 'ending'} onPress={() => void voiceCall.setMuted(!state.muted)} style={styles.control} accessibilityRole="button" accessibilityLabel={state.muted ? m.unmute : m.mute}>
            <View style={[styles.controlCircle, { backgroundColor: colors.surface.grouped }]}><Icon source={state.muted ? 'microphone-off' : 'microphone'} size={25} color={colors.text.primary} /></View>
            <Text style={[styles.controlLabel, { color: colors.text.secondary }]}>{state.muted ? m.unmute : m.mute}</Text>
          </Pressable>
          <Pressable disabled={state.phase !== 'connected'} onPress={() => {
            void setCallSpeaker(!speaker).then(() => setSpeaker(!speaker)).catch(() => voiceCall.pause('route_lost'));
          }} style={[styles.control, state.phase !== 'connected' && styles.disabled]} accessibilityRole="button" accessibilityLabel={speaker ? m.speaker : m.systemOutput}>
            <View style={[styles.controlCircle, { backgroundColor: colors.surface.grouped }]}><Icon source="volume-high" size={25} color={colors.text.primary} /></View>
            <Text style={[styles.controlLabel, { color: colors.text.secondary }]}>{speaker ? m.speaker : m.systemOutput}</Text>
          </Pressable>
          <Pressable onPress={() => void voiceCall.end()} style={styles.control} accessibilityRole="button" accessibilityLabel={m.end}>
            <View style={[styles.controlCircle, { backgroundColor: colors.semantic.error }]}><Icon source="phone-hangup" size={25} color={colors.text.inverse} /></View>
            <Text style={[styles.controlLabel, { color: colors.text.secondary }]}>{m.end}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  </>;
}
const styles = StyleSheet.create({
  screen: { flex: 1 }, grow: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: spacing.sm },
  header: { minHeight: 56, flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.sm },
  headerButton: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center' },
  content: { flexGrow: 1, padding: spacing.xl, gap: spacing.lg, alignItems: 'center', justifyContent: 'center' },
  voiceOrb: { width: 148, height: 148, borderRadius: 74, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.md },
  elapsed: { ...typography.heading, fontVariant: ['tabular-nums'] },
  card: { alignSelf: 'stretch', gap: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.xl, padding: spacing.lg },
  controls: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.lg, flexDirection: 'row', justifyContent: 'space-around' },
  control: { width: 92, alignItems: 'center', gap: spacing.sm },
  controlCircle: { width: 58, height: 58, borderRadius: 29, alignItems: 'center', justifyContent: 'center' },
  controlLabel: { ...typography.caption, textAlign: 'center' },
  disabled: { opacity: 0.42 },
  miniBar: { position: 'absolute', left: spacing.md, right: spacing.md, minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.sm, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.xl, elevation: 5, shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } },
  miniBody: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  miniIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  miniEnd: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
});
